// ── Recursive Pipeline Execution Engine ────────────────────────────────────
// Each Step runs via the pi SDK (createAgentSession) — no subprocess needed.

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import {
	createAgentSession,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
	type Tool,
} from "@mariozechner/pi-coding-agent";
import { evaluateGate, type GateResult } from "./gates.js";
import { mergeOutputs } from "./merge.js";
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

/** Model registry interface — for LLM gates and merge strategies */
export interface ModelRegistryLike {
	getAll(): Model<Api>[];
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
	/** Fallback model used by LLM gates and merge strategies */
	model: Model<Api>;
	modelRegistry: ModelRegistryLike;
	apiKey: string;
	cwd: string;
	hasUI: boolean;
	confirm?: (title: string, body: string) => Promise<boolean>;
	signal?: AbortSignal;
	onStepStart?: (label: string) => void;
	onStepEnd?: (result: StepResult) => void;
	/** Called with the accumulated text output as each delta arrives */
	onStepStream?: (text: string) => void;
	pipelineName: string;
}

/** Execute any Runnable recursively, returning output text */
export async function executeRunnable(
	runnable: Runnable,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	if (ectx.signal?.aborted) return { output: "(cancelled)", results: [] };

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

/** Map tool name strings (e.g. "read", "bash") to SDK Tool instances for a given cwd. */
function resolveTools(names: string[], cwd: string): Tool[] {
	return names.flatMap((name) => {
		switch (name) {
			case "read":
				return [createReadTool(cwd)];
			case "bash":
				return [createBashTool(cwd)];
			case "edit":
				return [createEditTool(cwd)];
			case "write":
				return [createWriteTool(cwd)];
			case "grep":
				return [createGrepTool(cwd)];
			case "find":
				return [createFindTool(cwd)];
			case "ls":
				return [createLsTool(cwd)];
			default:
				return [];
		}
	});
}

/** Resolve a model identifier string (e.g. "sonnet") to a Model object via the registry.
 * Prefers models from the same provider as the fallback (current session model) to avoid
 * accidentally resolving to Amazon Bedrock or other providers when multiple providers
 * have models with the same ID. */
function resolveModel(
	pattern: string,
	registry: ModelRegistryLike,
	fallback: Model<Api>,
): Model<Api> {
	const all = registry.getAll();
	const lower = pattern.toLowerCase();
	const sameProvider = (m: Model<Api>) => m.provider === fallback.provider;

	// 1. Exact id match within same provider
	const exactSameProvider = all.find(
		(m) => m.id.toLowerCase() === lower && sameProvider(m),
	);
	if (exactSameProvider) return exactSameProvider;

	// 2. Partial match within same provider (name or id)
	const partialSameProvider = all.find(
		(m) =>
			sameProvider(m) &&
			(m.id.toLowerCase().includes(lower) ||
				(m as { name?: string }).name?.toLowerCase().includes(lower)),
	);
	if (partialSameProvider) return partialSameProvider;

	// 3. No match in current provider — fall back to session model to avoid
	//    accidentally resolving to a different provider (e.g. Amazon Bedrock)
	//    that the user may not have credentials for.
	return fallback;
}

/** Resolve agent, create an SDK session, run the prompt, evaluate gate, apply transform. */
async function runStepCore(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{
	status: "passed" | "failed" | "skipped";
	output: string;
	gateResult?: GateResult;
	error?: string;
}> {
	const agent = step.agent ? ectx.agents[step.agent] : undefined;
	if (step.agent && !agent) {
		const available = Object.keys(ectx.agents).join(", ");
		throw new Error(
			`Agent "${step.agent}" not found. Available agents: ${available}`,
		);
	}

	const prompt = interpolatePrompt(step.prompt, input, original);

	// ── Resolve model ────────────────────────────────────────────────────
	// Default to the current session model (ectx.model) when no model is specified,
	// rather than a hardcoded alias like "sonnet" that could resolve to the wrong provider.
	const modelStr = step.model ?? agent?.model;
	const model = modelStr
		? resolveModel(modelStr, ectx.modelRegistry, ectx.model)
		: ectx.model;

	// ── Resolve tools ────────────────────────────────────────────────────
	const toolNames = step.tools ??
		agent?.tools ?? ["read", "bash", "edit", "write"];
	const tools = resolveTools(toolNames, ectx.cwd);

	// ── Build resource loader (skills, extensions, system prompt) ────────
	const systemPrompt = step.systemPrompt ?? agent?.systemPrompt;

	const loader = new DefaultResourceLoader({
		cwd: ectx.cwd,
		agentDir: getAgentDir(),
		...(systemPrompt && { systemPrompt }),
		...(step.extensions?.length > 0 && {
			additionalExtensionPaths: step.extensions,
		}),
		...(step.skills?.length > 0 && {
			additionalSkillPaths: step.skills,
		}),
	});
	await loader.reload();

	// ── Create in-process session ─────────────────────────────────────────
	const { session } = await createAgentSession({
		cwd: ectx.cwd,
		model,
		tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
		}),
	});

	// Wire abort signal → session.abort()
	const onAbort = () => session.abort();
	ectx.signal?.addEventListener("abort", onAbort);

	// Collect text output from streaming events
	let output = "";
	const unsub = session.subscribe((event) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent.type === "text_delta"
		) {
			output += event.assistantMessageEvent.delta;
			ectx.onStepStream?.(output);
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		unsub();
		ectx.signal?.removeEventListener("abort", onAbort);
		session.dispose();
	}

	output = output.trim();

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

	if (!gateResult.passed) {
		const failResult = await handleFailure(
			step,
			input,
			original,
			output,
			gateResult,
			ectx,
			0,
		);
		const transformed = await applyTransform(
			step.transform,
			failResult.output,
			ectx,
		);
		return { ...failResult, output: transformed, gateResult };
	}

	const transformed = await applyTransform(step.transform, output, ectx);
	return { status: "passed", output: transformed, gateResult };
}

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
		const core = await runStepCore(step, input, original, ectx);
		result.status = core.status;
		result.output = core.output;
		result.gateResult = core.gateResult;
		result.error = core.error;
	} catch (err) {
		result.status = "failed";
		result.error = err instanceof Error ? err.message : String(err);
		result.output = `Error: ${result.error}`;
	}

	result.elapsed = Date.now() - start;
	ectx.onStepEnd?.(result);
	return { output: result.output, results: [result] };
}

// ── Shared Gate + OnFail for Composition Nodes ────────────────────────────

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

	const gateStepResult: StepResult = {
		label: `[gate] ${scopeLabel}`,
		status: gateResult.passed ? "passed" : "failed",
		output: gateResult.reason,
		gateResult,
		elapsed: 0,
	};
	ectx.onStepEnd?.(gateStepResult);

	if (gateResult.passed)
		return { output, results: [...results, gateStepResult] };
	if (!onFail) return { output, results: [...results, gateStepResult] };

	switch (onFail.action) {
		case "retry":
		case "retryWithDelay": {
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				gateStepResult.error = `Gate failed after ${max} retries: ${gateResult.reason}`;
				return { output, results: [...results, gateStepResult] };
			}
			if (onFail.action === "retryWithDelay") {
				await new Promise((r) => setTimeout(r, onFail.delayMs));
			}
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
			gateStepResult.status = "passed";
			gateStepResult.error = `⚠️ Warning (gate failed but continued): ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "fallback": {
			const fallback = await executeStep(
				{ ...onFail.step, kind: "step" },
				output,
				output,
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
		currentInput = output;
		const lastResult = results.at(-1);
		if (lastResult?.status === "failed") break;
	}

	return gateCheck(
		currentInput,
		allResults,
		seq.gate,
		seq.onFail,
		`sequential (${seq.steps.length} steps)`,
		() => executeSequential(seq, input, original, ectx),
		ectx,
		0,
	);
}

// ── Pool ──────────────────────────────────────────────────────────────────

async function executePool(
	pool: Pool,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	const worktrees: { path: string; branch: string }[] = [];
	const allResults: StepResult[] = [];

	try {
		const promises = Array.from({ length: pool.count }, async (_, i) => {
			const label = getLabel(pool.step) || `pool-${i}`;
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
			return executeRunnable(
				pool.step,
				`${input}\n[Branch ${i + 1} of ${pool.count}]`,
				original,
				branchCtx,
			);
		});

		const settled = await Promise.allSettled(promises);
		const outputs: string[] = [];
		for (const r of settled) {
			if (r.status === "fulfilled") {
				outputs.push(r.value.output);
				allResults.push(...r.value.results);
			} else outputs.push(`(error: ${r.reason})`);
		}

		const merged = await mergeOutputs(pool.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});
		return gateCheck(
			merged,
			allResults,
			pool.gate,
			pool.onFail,
			`pool ×${pool.count}`,
			() => executePool(pool, input, original, ectx),
			ectx,
			0,
		);
	} finally {
		for (const wt of worktrees)
			await removeWorktree(
				ectx.exec,
				ectx.cwd,
				wt.path,
				wt.branch,
				ectx.signal,
			);
	}
}

// ── Parallel ──────────────────────────────────────────────────────────────

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

		const settled = await Promise.allSettled(promises);
		const outputs: string[] = [];
		for (const r of settled) {
			if (r.status === "fulfilled") {
				outputs.push(r.value.output);
				allResults.push(...r.value.results);
			} else outputs.push(`(error: ${r.reason})`);
		}

		const merged = await mergeOutputs(par.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});
		return gateCheck(
			merged,
			allResults,
			par.gate,
			par.onFail,
			`parallel (${par.steps.length} branches)`,
			() => executeParallel(par, input, original, ectx),
			ectx,
			0,
		);
	} finally {
		for (const wt of worktrees)
			await removeWorktree(
				ectx.exec,
				ectx.cwd,
				wt.path,
				wt.branch,
				ectx.signal,
			);
	}
}

// ── Helpers ────────────────────────────────────────────────────────────────

function interpolatePrompt(
	template: string,
	input: string,
	original: string,
): string {
	return template.replace(/\$INPUT/g, input).replace(/\$ORIGINAL/g, original);
}

async function applyTransform(
	transform: Transform,
	output: string,
	ectx: ExecutorContext,
): Promise<string> {
	switch (transform.kind) {
		case "full":
			return output;

		case "extract": {
			try {
				const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/) || [
					null,
					output,
				];
				const parsed = JSON.parse(jsonMatch[1]?.trim());
				return String(parsed[transform.key] ?? output);
			} catch {
				return output;
			}
		}

		case "summarize": {
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
				return output;
			}
		}

		default:
			return output;
	}
}

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
		case "retry":
		case "retryWithDelay": {
			const max = onFail.max ?? 3;
			if (retryCount >= max) {
				return {
					status: "failed",
					output: lastOutput,
					error: `Gate failed after ${max} retries: ${gateResult.reason}`,
				};
			}
			if (onFail.action === "retryWithDelay") {
				await new Promise((r) => setTimeout(r, onFail.delayMs));
			}
			const retryPrompt = `${step.prompt}\n\n[RETRY ${retryCount + 1}/${max}: Previous attempt failed gate: ${gateResult.reason}]\n\nPrevious output:\n${lastOutput.slice(0, 1000)}`;
			const retryStep: Step = { ...step, prompt: retryPrompt };
			const { output, results } = await executeStep(
				retryStep,
				input,
				original,
				ectx,
			);
			const lastResult = results.at(-1);
			if (lastResult?.status === "passed") return { status: "passed", output };
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
			return {
				status: "passed",
				output: lastOutput,
				error: `⚠️ Warning (gate failed but continued): ${gateResult.reason}`,
			};

		case "fallback": {
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
