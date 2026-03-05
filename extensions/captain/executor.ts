// ── Recursive Pipeline Execution Engine ────────────────────────────────────

import type {
	AgentContext,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
} from "@mariozechner/pi-agent-core";
import { agentLoop } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import { convertToLlm } from "@mariozechner/pi-coding-agent";
import { evaluateGate, type GateResult } from "./gates.js";
import { mergeOutputs } from "./merge.js";
import { resolveTools } from "./tool-resolver.js";
import type {
	Agent,
	Gate,
	OnFail,
	Parallel,
	Pool,
	Runnable,
	Sequential,
	Step,
	StepResult,
	Transform,
} from "./types.js";
import { createWorktree, removeWorktree } from "./worktree.js";

/** Model registry interface — matches ModelRegistry from pi-coding-agent */
export interface ModelRegistryLike {
	find(provider: string, modelId: string): Model<Api> | undefined;
	getApiKey(model: Model<Api>): Promise<string | undefined>;
}

/** Everything the executor needs from the host environment */
export interface ExecutorContext {
	exec: (
		cmd: string,
		args: string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
	agents: Record<string, Agent>;
	model: Model<Api>;
	modelRegistry: ModelRegistryLike;
	apiKey: string;
	cwd: string;
	hasUI: boolean;
	confirm?: (title: string, body: string) => Promise<boolean>;
	signal?: AbortSignal;
	onStepStart?: (label: string) => void;
	onStepEnd?: (result: StepResult) => void;
	pipelineName: string;

	/** Extension-registered custom tools, available to pipeline agents */
	extensionTools?: Map<string, AgentTool>;
}

/** Execute any Runnable recursively, returning output text */
export async function executeRunnable(
	runnable: Runnable,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	if (ectx.signal?.aborted) {
		return { output: "(cancelled)", results: [] };
	}

	switch (runnable.kind) {
		case "step":
			return executeStep(runnable, input, original, ectx);
		case "sequential":
			return executeSequential(runnable, input, original, ectx);
		case "pool":
			return executePool(runnable, input, original, ectx);
		case "parallel":
			return executeParallel(runnable, input, original, ectx);
		default:
			return {
				output: `Unknown runnable kind: ${(runnable as Runnable & { kind: string }).kind}`,
				results: [],
			};
	}
}

// ── Step Execution ─────────────────────────────────────────────────────────

async function executeStep(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	const start = Date.now();
	ectx.onStepStart?.(step.label);

	const result: StepResult = {
		label: step.label,
		status: "running",
		output: "",
		elapsed: 0,
	};

	try {
		// Validate agent exists before proceeding
		const agent = ectx.agents[step.agent];
		if (!agent) {
			const available = Object.keys(ectx.agents).join(", ");
			throw new Error(
				`Agent "${step.agent}" not found. Available agents: ${available}`,
			);
		}

		// Resolve prompt with variable interpolation
		const prompt = interpolatePrompt(step.prompt, input, original);

		// Resolve the agent's model (or fall back to current)
		const model = resolveModel(agent, ectx);
		const apiKey = ectx.apiKey;

		// Resolve the agent's declared tools into executable AgentTool instances.
		// If no tools resolve, the loop just does a single LLM call and stops.
		const tools = resolveTools(agent.tools, ectx.cwd, ectx.extensionTools);

		const output = await runAgentLoop(
			step,
			agent,
			prompt,
			tools,
			model,
			apiKey,
			ectx,
		);

		// Evaluate gate (model/apiKey/modelRegistry passed for LLM gate support)
		const gateResult = await evaluateGate(step.gate, output, {
			exec: ectx.exec,
			confirm: ectx.confirm,
			hasUI: ectx.hasUI,
			cwd: ectx.cwd,
			signal: ectx.signal,
			model: ectx.model,
			apiKey: ectx.apiKey,
			modelRegistry: ectx.modelRegistry,
		});

		result.gateResult = gateResult;

		if (!gateResult.passed) {
			// Handle failure according to onFail strategy
			const failResult = await handleFailure(
				step,
				input,
				original,
				output,
				gateResult,
				ectx,
				0,
			);
			result.status = failResult.status;
			result.output = failResult.output;
			result.error = failResult.error;
		} else {
			result.status = "passed";
			result.output = output;
		}

		// Apply transform to the output before passing downstream
		result.output = await applyTransform(step.transform, result.output, ectx);
	} catch (err) {
		result.status = "failed";
		result.error = err instanceof Error ? err.message : String(err);
		result.output = `Error: ${result.error}`;
	}

	result.elapsed = Date.now() - start;
	ectx.onStepEnd?.(result);
	return { output: result.output, results: [result] };
}

// ── Agentic Loop Runner ───────────────────────────────────────────────────

/**
 * Run a full agentic loop for a step that has tools.
 * The LLM can call tools (read, bash, edit, etc.) in a multi-turn loop
 * until it produces a final text response or hits the turn limit.
 */
async function runAgentLoop(
	step: Step,
	agent: Agent,
	prompt: string,
	tools: AgentTool[],
	model: Model<Api>,
	apiKey: string,
	ectx: ExecutorContext,
): Promise<string> {
	// Build initial context for the loop
	const agentContext: AgentContext = {
		systemPrompt: agent.systemPrompt ?? "",
		messages: [], // empty — agentLoop() prepends the prompts array
		tools,
	};

	// Safety: create our own AbortController to enforce maxTurns
	const maxTurns = step.maxTurns ?? 10;
	const loopAbort = new AbortController();

	// Forward parent abort signal to our loop controller
	if (ectx.signal) {
		if (ectx.signal.aborted) {
			loopAbort.abort();
		} else {
			ectx.signal.addEventListener("abort", () => loopAbort.abort(), {
				once: true,
			});
		}
	}

	// Build loop config
	const config: AgentLoopConfig = {
		model,
		apiKey,
		maxTokens: step.maxTokens ?? 8192,
		signal: loopAbort.signal,

		// Standard pi converter: handles user/assistant/toolResult,
		// filters out custom message types
		convertToLlm,

		// No auto-continue: we don't want follow-up messages
		getFollowUpMessages: async () => [],
	};

	// The prompt message to kick off the loop
	const userMessage: AgentMessage = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	// Run the agentic loop
	const stream = agentLoop(
		[userMessage],
		agentContext,
		config,
		loopAbort.signal,
	);

	// Consume events, collecting text output
	const result = await consumeAgentEvents(
		stream,
		loopAbort,
		maxTurns,
		step.label,
		ectx,
	);
	return result;
}

/** Extract text content from an assistant message */
function extractAssistantText(msg: {
	role: string;
	content: ReadonlyArray<{ type: string; text?: string }>;
}): string {
	return msg.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

/** Handle a single agent loop event, updating state and returning extracted text if any */
function handleAgentEvent(
	event: { type: string; [key: string]: unknown },
	turnState: { count: number },
	maxTurns: number,
	loopAbort: AbortController,
	stepLabel: string,
	ectx: ExecutorContext,
): string | undefined {
	switch (event.type) {
		case "turn_start":
			turnState.count++;
			if (turnState.count > maxTurns) {
				loopAbort.abort();
			}
			return undefined;

		case "message_end": {
			const msg = event.message as
				| {
						role: string;
						content: ReadonlyArray<{ type: string; text?: string }>;
				  }
				| undefined;
			if (msg?.role === "assistant") {
				return extractAssistantText(msg) || undefined;
			}
			return undefined;
		}

		case "tool_execution_start":
			ectx.onStepStart?.(`${stepLabel} → ${event.toolName as string}`);
			return undefined;

		default:
			return undefined;
	}
}

/** Consume agent loop events and return final assistant text */
async function consumeAgentEvents(
	stream: AsyncIterable<{ type: string; [key: string]: unknown }>,
	loopAbort: AbortController,
	maxTurns: number,
	stepLabel: string,
	ectx: ExecutorContext,
): Promise<string> {
	let lastAssistantText = "";
	const turnState = { count: 0 };

	for await (const event of stream) {
		if (loopAbort.signal.aborted) break;
		const text = handleAgentEvent(
			event,
			turnState,
			maxTurns,
			loopAbort,
			stepLabel,
			ectx,
		);
		if (text) lastAssistantText = text;
	}

	return lastAssistantText;
}

// ── Shared Gate + OnFail for Composition Nodes ────────────────────────────

/**
 * Evaluate a gate on a composition node's output and handle failures.
 * Shared by executeSequential, executePool, and executeParallel.
 * Returns the (possibly retried) output+results, plus a synthetic StepResult for the gate.
 */
async function gateCheck(
	output: string,
	results: StepResult[],
	gate: Gate | undefined,
	onFail: OnFail | undefined,
	scopeLabel: string,
	rerunFn: () => Promise<{ output: string; results: StepResult[] }>,
	ectx: ExecutorContext,
	retryCount: number,
): Promise<{ output: string; results: StepResult[] }> {
	// No gate → pass through unchanged
	if (!gate || gate.type === "none") return { output, results };

	const gateResult = await evaluateGate(gate, output, {
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		cwd: ectx.cwd,
		signal: ectx.signal,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
	});

	// Emit a synthetic StepResult so the gate shows in pipeline status
	const gateStepResult: StepResult = {
		label: `[gate] ${scopeLabel}`,
		status: gateResult.passed ? "passed" : "failed",
		output: gateResult.reason,
		gateResult,
		elapsed: 0,
	};
	ectx.onStepEnd?.(gateStepResult);

	if (gateResult.passed) {
		return { output, results: [...results, gateStepResult] };
	}

	// Gate failed — apply onFail strategy
	if (!onFail) {
		// No onFail defined — treat as hard failure, return as-is with gate result
		return { output, results: [...results, gateStepResult] };
	}

	switch (onFail.action) {
		case "retry": {
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				gateStepResult.error = `Gate failed after ${max} retries: ${gateResult.reason}`;
				return { output, results: [...results, gateStepResult] };
			}
			// Re-run the entire scope, then gate-check again (recursive)
			const retried = await rerunFn();
			return gateCheck(
				retried.output,
				retried.results,
				gate,
				onFail,
				scopeLabel,
				rerunFn,
				ectx,
				retryCount + 1,
			);
		}

		case "retryWithDelay": {
			// Retry with a configurable delay between attempts
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				gateStepResult.error = `Gate failed after ${max} retries (with ${onFail.delayMs}ms delay): ${gateResult.reason}`;
				return { output, results: [...results, gateStepResult] };
			}
			await new Promise((resolve) => setTimeout(resolve, onFail.delayMs));
			const retried = await rerunFn();
			return gateCheck(
				retried.output,
				retried.results,
				gate,
				onFail,
				scopeLabel,
				rerunFn,
				ectx,
				retryCount + 1,
			);
		}

		case "skip":
			gateStepResult.status = "skipped";
			gateStepResult.error = `Skipped: ${gateResult.reason}`;
			return { output: "", results: [...results, gateStepResult] };

		case "warn":
			// Non-blocking: gate failed but we continue with the output anyway
			gateStepResult.status = "passed";
			gateStepResult.error = `⚠️ Warning (gate failed but continued): ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "fallback": {
			const fallback = await executeStep(
				{ ...onFail.step, kind: "step" },
				output, // feed the failed output as input to the fallback
				output, // original context
				ectx,
			);
			return {
				output: fallback.output,
				results: [...results, gateStepResult, ...fallback.results],
			};
		}

		default:
			return { output, results: [...results, gateStepResult] };
	}
}

// ── Sequential ─────────────────────────────────────────────────────────────

async function executeSequential(
	seq: Sequential,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	let currentInput = input;
	const allResults: StepResult[] = [];

	for (const step of seq.steps) {
		if (ectx.signal?.aborted) break;

		const { output, results } = await executeRunnable(
			step,
			currentInput,
			original,
			ectx,
		);
		allResults.push(...results);
		currentInput = output; // chain output → next step's $INPUT

		// Fail-fast: stop the chain if any step failed (don't feed errors downstream)
		const lastResult = results.at(-1);
		if (lastResult?.status === "failed") break;
	}

	// Gate check on the sequence's final output (if gate is defined)
	return gateCheck(
		currentInput,
		allResults,
		seq.gate,
		seq.onFail,
		`sequential (${seq.steps.length} steps)`,
		// rerunFn: re-execute the entire sequence from scratch
		() => executeSequential(seq, input, original, ectx),
		ectx,
		0,
	);
}

// ── Pool (same step × N, parallel with worktrees) ─────────────────────────

async function executePool(
	pool: Pool,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	const worktrees: { path: string; branch: string }[] = [];
	const allResults: StepResult[] = [];

	try {
		// Launch N copies in parallel
		const promises = Array.from({ length: pool.count }, async (_, i) => {
			const label = getLabel(pool.step) || `pool-${i}`;

			// Create worktree for isolation
			const wt = await createWorktree(
				ectx.exec,
				ectx.cwd,
				ectx.pipelineName,
				label,
				i,
				ectx.signal,
			);
			if (wt) worktrees.push({ path: wt.worktreePath, branch: wt.branchName });

			// Execute in worktree cwd if available, else main cwd
			const branchCtx: ExecutorContext = {
				...ectx,
				cwd: wt?.worktreePath ?? ectx.cwd,
			};

			return executeRunnable(
				pool.step,
				`${input}\n[Branch ${i + 1} of ${pool.count}]`,
				original,
				branchCtx,
			);
		});

		const results = await Promise.allSettled(promises);
		const outputs: string[] = [];

		for (const r of results) {
			if (r.status === "fulfilled") {
				outputs.push(r.value.output);
				allResults.push(...r.value.results);
			} else {
				outputs.push(`(error: ${r.reason})`);
			}
		}

		// Merge outputs using strategy
		const merged = await mergeOutputs(pool.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});

		// Gate check on the merged output (if gate is defined)
		return gateCheck(
			merged,
			allResults,
			pool.gate,
			pool.onFail,
			`pool ×${pool.count}`,
			// rerunFn: re-launch all N branches + re-merge
			() => executePool(pool, input, original, ectx),
			ectx,
			0,
		);
	} finally {
		// Always clean up worktrees
		for (const wt of worktrees) {
			await removeWorktree(
				ectx.exec,
				ectx.cwd,
				wt.path,
				wt.branch,
				ectx.signal,
			);
		}
	}
}

// ── Parallel (different steps, concurrent with worktrees) ──────────────────

async function executeParallel(
	par: Parallel,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	const worktrees: { path: string; branch: string }[] = [];
	const allResults: StepResult[] = [];

	try {
		const promises = par.steps.map(async (step, i) => {
			const label = getLabel(step) || `parallel-${i}`;

			const wt = await createWorktree(
				ectx.exec,
				ectx.cwd,
				ectx.pipelineName,
				label,
				i,
				ectx.signal,
			);
			if (wt) worktrees.push({ path: wt.worktreePath, branch: wt.branchName });

			const branchCtx: ExecutorContext = {
				...ectx,
				cwd: wt?.worktreePath ?? ectx.cwd,
			};

			return executeRunnable(step, input, original, branchCtx);
		});

		const results = await Promise.allSettled(promises);
		const outputs: string[] = [];

		for (const r of results) {
			if (r.status === "fulfilled") {
				outputs.push(r.value.output);
				allResults.push(...r.value.results);
			} else {
				outputs.push(`(error: ${r.reason})`);
			}
		}

		const merged = await mergeOutputs(par.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});

		// Gate check on the merged output (if gate is defined)
		return gateCheck(
			merged,
			allResults,
			par.gate,
			par.onFail,
			`parallel (${par.steps.length} branches)`,
			// rerunFn: re-run all branches + re-merge
			() => executeParallel(par, input, original, ectx),
			ectx,
			0,
		);
	} finally {
		for (const wt of worktrees) {
			await removeWorktree(
				ectx.exec,
				ectx.cwd,
				wt.path,
				wt.branch,
				ectx.signal,
			);
		}
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Interpolate $INPUT, $ORIGINAL, and ${var} in prompts */
function interpolatePrompt(
	template: string,
	input: string,
	original: string,
): string {
	return template.replace(/\$INPUT/g, input).replace(/\$ORIGINAL/g, original);
}

/** Resolve the model for an agent, falling back to current model.
 *  Tries the current model's provider first (most likely match),
 *  then common providers as fallback. */
function resolveModel(
	agent: Agent | undefined,
	ectx: ExecutorContext,
): Model<Api> {
	if (!agent?.model) return ectx.model;

	// Try current model's provider first, then common ones
	const currentProvider = ectx.model?.provider;
	const providers = [
		currentProvider,
		"anthropic",
		"google",
		"openai",
		"openrouter",
		"deepseek",
	].filter((p): p is string => !!p);

	// Deduplicate while preserving order
	const seen = new Set<string>();
	for (const provider of providers) {
		if (seen.has(provider)) continue;
		seen.add(provider);
		try {
			const found = ectx.modelRegistry.find(provider, agent.model);
			if (found) return found;
		} catch {
			// Provider not available, try next
		}
	}

	return ectx.model;
}

/** Apply transform to step output */
async function applyTransform(
	transform: Transform,
	output: string,
	ectx: ExecutorContext,
): Promise<string> {
	switch (transform.kind) {
		case "full":
			return output;

		case "extract": {
			// Try to parse JSON and extract a key
			try {
				// Find JSON in the output (may be wrapped in markdown code blocks)
				const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/) || [
					null,
					output,
				];
				const parsed = JSON.parse(jsonMatch[1]?.trim());
				return String(parsed[transform.key] ?? output);
			} catch {
				return output; // fallback to full output if JSON parse fails
			}
		}

		case "summarize": {
			// Ask LLM to summarize
			try {
				const response = await complete(
					ectx.model,
					{
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: `Summarize concisely in 2-3 sentences:\n\n${output.slice(0, 4000)}`,
									},
								],
								timestamp: Date.now(),
							},
						],
					},
					{ apiKey: ectx.apiKey, maxTokens: 512, signal: ectx.signal },
				);
				return response.content
					.filter((c): c is { type: "text"; text: string } => c.type === "text")
					.map((c) => c.text)
					.join("\n");
			} catch {
				return output; // fallback on error
			}
		}

		default:
			return output;
	}
}

/** Handle step failure according to onFail strategy */
async function handleFailure(
	step: Step,
	input: string,
	original: string,
	lastOutput: string,
	gateResult: GateResult,
	ectx: ExecutorContext,
	retryCount: number,
): Promise<{
	status: "passed" | "failed" | "skipped";
	output: string;
	error?: string;
}> {
	const onFail = step.onFail;

	switch (onFail.action) {
		case "retry": {
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				return {
					status: "failed",
					output: lastOutput,
					error: `Gate failed after ${max} retries: ${gateResult.reason}`,
				};
			}
			// Retry the step with feedback about the failure
			const retryPrompt = `${step.prompt}\n\n[RETRY ${retryCount + 1}/${max}: Previous attempt failed gate: ${gateResult.reason}]\n\nPrevious output:\n${lastOutput.slice(0, 1000)}`;
			const retryStep: Step = { ...step, prompt: retryPrompt };
			const { output, results } = await executeStep(
				retryStep,
				input,
				original,
				ectx,
			);
			const lastResult = results.at(-1);
			if (lastResult?.status === "passed") {
				return { status: "passed", output };
			}
			// Recursive retry
			return handleFailure(
				step,
				input,
				original,
				output,
				lastResult?.gateResult ?? gateResult,
				ectx,
				retryCount + 1,
			);
		}

		case "retryWithDelay": {
			// Retry with a delay between attempts — useful for flaky services or rate limits
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				return {
					status: "failed",
					output: lastOutput,
					error: `Gate failed after ${max} retries (with ${onFail.delayMs}ms delay): ${gateResult.reason}`,
				};
			}
			// Wait before retrying
			await new Promise((resolve) => setTimeout(resolve, onFail.delayMs));
			const retryPrompt = `${step.prompt}\n\n[RETRY ${retryCount + 1}/${max}: Previous attempt failed gate: ${gateResult.reason}]\n\nPrevious output:\n${lastOutput.slice(0, 1000)}`;
			const retryStep: Step = { ...step, prompt: retryPrompt };
			const { output, results } = await executeStep(
				retryStep,
				input,
				original,
				ectx,
			);
			const lastResult = results.at(-1);
			if (lastResult?.status === "passed") {
				return { status: "passed", output };
			}
			return handleFailure(
				step,
				input,
				original,
				output,
				lastResult?.gateResult ?? gateResult,
				ectx,
				retryCount + 1,
			);
		}

		case "skip":
			return {
				status: "skipped",
				output: "",
				error: `Skipped: ${gateResult.reason}`,
			};

		case "warn":
			// Pass through the output despite the gate failure — non-blocking
			return {
				status: "passed",
				output: lastOutput,
				error: `⚠️ Warning (gate failed but continued): ${gateResult.reason}`,
			};

		case "fallback": {
			// Execute the fallback step instead
			const { output } = await executeStep(
				{ ...onFail.step, kind: "step" },
				input,
				original,
				ectx,
			);
			return { status: "passed", output };
		}

		default:
			return { status: "failed", output: lastOutput, error: gateResult.reason };
	}
}

/** Get a human-readable label from any Runnable (used for worktree branch naming) */
function getLabel(r: Runnable): string {
	switch (r.kind) {
		case "step":
			return r.label;
		case "sequential":
			return `seq-${r.steps[0] ? getLabel(r.steps[0]) : "empty"}`;
		case "pool":
			return `pool-${getLabel(r.step)}`;
		case "parallel":
			return "par";
		default:
			return "unknown";
	}
}
