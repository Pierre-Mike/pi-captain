// ── Core Step Execution ───────────────────────────────────────────────────
// runStep function and session creation/warming logic

import { appendFileSync } from "node:fs";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
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
} from "@mariozechner/pi-coding-agent";
import { type GateResult, runGate } from "../gates/index.js";
import type { GateCtx, Step, StepResult, Transform } from "../types.js";
import { type ModelRegistryLike, resolveModel } from "../utils/model.js";

export type { ModelRegistryLike };

/** Everything the executor needs from the host environment */
export interface ExecutorContext {
	exec: (
		cmd: string,
		args: string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
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
	/** Called with the step label and accumulated text output as each delta arrives */
	onStepStream?: (label: string, text: string) => void;
	/** Called whenever a tool call completes for a running step, with total calls so far */
	onStepToolCall?: (label: string, totalCalls: number) => void;
	pipelineName: string;
	/** Group label for steps running inside a parallel/pool — set by the executor */
	stepGroup?: string;
	/**
	 * Shared loader cache for the lifetime of one pipeline run.
	 * Keys are JSON-serialised loader config (cwd + agentDir + systemPrompt +
	 * extensions + skills).  Steps that share the same config reuse the already-
	 * reloaded loader instead of hitting the disk on every step.
	 */
	loaderCache?: Map<string, DefaultResourceLoader>;
	/**
	 * Pre-resolved git-repo flag for the current cwd.
	 * Set once before spawning parallel branches so every branch skips its own
	 * `git rev-parse` subprocess.
	 */
	isGitRepo?: boolean;
}

const _captainDebug = (msg: string) => {
	if (process.env.CAPTAIN_DEBUG) appendFileSync("/tmp/captain-debug.log", msg);
};

/**
 * Hard ceiling on retry attempts enforced by the executor, regardless of what
 * the user-supplied onFail function returns. Prevents infinite loops when an
 * inline onFail always returns { action: "retry" } with no exit condition.
 */
const MAX_EXECUTOR_RETRIES = 10;

// ── Tool Resolution ────────────────────────────────────────────────────────

/** Map tool name strings (e.g. "read", "bash") to SDK Tool instances for a given cwd. */
// biome-ignore lint/suspicious/noExplicitAny: tool schemas vary per tool, mixed array is intentional
type AnyAgentTool = AgentTool<any>;

function resolveTools(names: string[], cwd: string): AnyAgentTool[] {
	return names.flatMap((name): AnyAgentTool[] => {
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

// ── Loader Cache Helper ───────────────────────────────────────────────────

/**
 * Build (or reuse from cache) a DefaultResourceLoader for the given config.
 * The cache key is derived from every field that affects what the loader loads,
 * so steps with identical configs share one loader instead of each doing a full
 * disk scan.
 */
async function getOrCreateLoader(
	ectx: ExecutorContext,
	systemPrompt: string | undefined,
	extensions: string[] | undefined,
	skills: string[] | undefined,
): Promise<DefaultResourceLoader> {
	const agentDir = getAgentDir();
	const key = JSON.stringify({
		cwd: ectx.cwd,
		agentDir,
		systemPrompt,
		extensions: extensions ?? [],
		skills: skills ?? [],
	});

	if (ectx.loaderCache?.has(key)) {
		return ectx.loaderCache.get(key) as DefaultResourceLoader;
	}

	const loader = new DefaultResourceLoader({
		cwd: ectx.cwd,
		agentDir,
		...(systemPrompt && { systemPrompt }),
		...((extensions?.length ?? 0) > 0 && {
			additionalExtensionPaths: extensions,
		}),
		...((skills?.length ?? 0) > 0 && {
			additionalSkillPaths: skills,
		}),
	});
	await loader.reload();

	ectx.loaderCache?.set(key, loader);
	return loader;
}

// ── Session Prefetch ──────────────────────────────────────────────────────

/**
 * A warm session that has been created (model loaded, tools wired, resource
 * loader injected) but has NOT yet had `.prompt()` called on it.
 * The session is ready to receive a prompt the moment the previous step's
 * output ($INPUT) is known, eliminating the session-setup latency from the
 * critical path of sequential pipelines.
 */
export type WarmSession = {
	session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	resolvedModel: Model<Api>;
};

/**
 * Start creating an agent session for `step` in the background.
 * Returns a Promise that resolves to a WarmSession (or null on any error /
 * if the pipeline is already cancelled).  The caller must either:
 *   • pass the WarmSession into runStepCore, or
 *   • call warm.session.dispose() if the step is never executed.
 *
 * Prefetch is purely opportunistic — it never throws; errors are swallowed
 * and fall back to the normal cold-start path.
 */
export function prefetchSession(
	step: Step,
	ectx: ExecutorContext,
): Promise<WarmSession | null> {
	return (async (): Promise<WarmSession | null> => {
		if (ectx.signal?.aborted) return null;
		try {
			const resolvedModel = step.model
				? resolveModel(step.model, ectx.modelRegistry, ectx.model)
				: ectx.model;
			const toolNames = step.tools ?? ["read", "bash", "edit", "write"];
			const tools = resolveTools(toolNames, ectx.cwd);
			const loader = await getOrCreateLoader(
				ectx,
				step.systemPrompt,
				step.extensions,
				step.skills,
			);
			const { session } = await createAgentSession({
				cwd: ectx.cwd,
				model: resolvedModel,
				tools,
				resourceLoader: loader,
				sessionManager: SessionManager.inMemory(),
				settingsManager: SettingsManager.inMemory({
					compaction: { enabled: false },
				}),
				...(step.temperature !== undefined && {
					temperature: step.temperature,
				}),
			});
			return { session, resolvedModel };
		} catch {
			// Prefetch is best-effort — never crash the pipeline.
			return null;
		}
	})();
}

// ── Core Step Execution ───────────────────────────────────────────────────

/** Resolve agent, create an SDK session, run the prompt, evaluate gate, apply transform. */
async function runStepCore(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
	/** Pre-resolved model from executeStep — avoids a second registry scan */
	resolvedModel: Model<Api>,
	/** Prefetch: pre-warmed session created while the previous step was running */
	warmSession?: WarmSession | null,
): Promise<{
	status: "passed" | "failed" | "skipped";
	output: string;
	gateResult?: GateResult;
	error?: string;
	toolCallCount: number;
}> {
	const prompt = interpolatePrompt(step.prompt, input, original);

	// Use the pre-resolved model directly
	const model = resolvedModel;

	// Resolve tools
	const toolNames = step.tools ?? ["read", "bash", "edit", "write"];

	// Obtain session — prefetched (warm) or cold-start
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	if (warmSession) {
		session = warmSession.session;
	} else {
		const tools = resolveTools(toolNames, ectx.cwd);
		const loader = await getOrCreateLoader(
			ectx,
			step.systemPrompt,
			step.extensions,
			step.skills,
		);
		({ session } = await createAgentSession({
			cwd: ectx.cwd,
			model,
			tools,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
			}),
			...(step.temperature !== undefined && { temperature: step.temperature }),
		}));
	}

	// Activate extension tools (e.g. web_search)
	session.setActiveToolsByName(toolNames);

	// Wire abort signal → session.abort()
	const onAbort = () => session.abort();
	ectx.signal?.addEventListener("abort", onAbort);

	// Collect text output and tool results
	let output = "";
	let toolCallCount = 0;
	const toolOutputs: string[] = [];
	const toolsUsed: string[] = [];

	const handleToolExecutionEnd = (event: {
		type: "tool_execution_end";
		toolName: string;
		isError: boolean;
		result: unknown;
	}) => {
		toolCallCount++;
		ectx.onStepToolCall?.(step.label, toolCallCount);
		if (event.isError) return;
		if (!toolsUsed.includes(event.toolName)) toolsUsed.push(event.toolName);
		const result = event.result;
		if (typeof result === "string" && result.trim()) {
			toolOutputs.push(`[${event.toolName}]\n${result.trim()}`);
		} else if (result && typeof result === "object") {
			const text =
				(result as { output?: string; content?: string }).output ??
				(result as { output?: string; content?: string }).content;
			if (text?.trim()) toolOutputs.push(`[${event.toolName}]\n${text.trim()}`);
		}
	};

	// biome-ignore lint/suspicious/noExplicitAny: session event type varies by SDK version
	const unsub = session.subscribe((event: any) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent?.type === "text_delta"
		) {
			output += event.assistantMessageEvent.delta;
			ectx.onStepStream?.(step.label, output);
		} else if (event.type === "tool_execution_start") {
			ectx.onStepStream?.(step.label, output || `[calling ${event.toolName}…]`);
		} else if (event.type === "tool_execution_end") {
			handleToolExecutionEnd(event);
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		unsub();
		ectx.signal?.removeEventListener("abort", onAbort);
	}

	output = output.trim();

	// Fallback 1: last assistant message text (covers streaming gaps)
	if (!output) {
		const fallback1 = session.getLastAssistantText()?.trim() ?? "";
		_captainDebug(
			`[${step.label}] streaming_empty, getLastAssistantText="${fallback1.slice(0, 200)}"\n`,
		);
		output = fallback1;
	}

	// Fallback 2: accumulated tool outputs (when model ends on a tool call
	// with no trailing text block — common with bash-heavy research steps)
	if (!output && toolOutputs.length > 0) {
		_captainDebug(
			`[${step.label}] fallback2 toolOutputs count=${toolOutputs.length}\n`,
		);
		output = toolOutputs.join("\n\n");
	}

	if (!output) {
		const msgSummary = JSON.stringify(
			// biome-ignore lint/suspicious/noExplicitAny: AgentMessage content is a union type
			(session.messages as any[]).map((m) => ({
				role: m.role,
				text: (typeof m.content === "string"
					? m.content
					: m.content?.[0]?.text
				)?.slice(0, 50),
				errMsg: m.errorMessage?.slice(0, 100),
			})),
		);
		_captainDebug(
			`[${step.label}] ALL FALLBACKS EMPTY - messages count=${session.messages.length}, msgs=${msgSummary}\n`,
		);
	} else {
		_captainDebug(`[${step.label}] output="${output.slice(0, 100)}"\n`);
	}

	// Dispose session
	await session.dispose();

	const gateCtx = { ...makeGateCtx(ectx), toolsUsed };

	const gateResult = step.gate
		? await runGate(step.gate, output, gateCtx)
		: { passed: true, reason: "No gate" };

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
		return {
			...failResult,
			gateResult,
			toolCallCount,
		};
	}

	return {
		status: "passed",
		output,
		gateResult,
		toolCallCount,
	};
}

/**
 * Execute a single step with optional warm session prefetch.
 * Main entry point for step execution.
 */
export async function executeStep(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
	/** Prefetch: pre-warmed session passed down from executeSequential */
	warmSession?: WarmSession | null,
): Promise<{ output: string; results: StepResult[] }> {
	const start = Date.now();
	ectx.onStepStart?.(step.label);

	// If a warm session was provided, use its already-resolved model (consistent
	// with what was used to create the session). Otherwise resolve now.
	const resolvedModel =
		warmSession?.resolvedModel ??
		(step.model
			? resolveModel(step.model, ectx.modelRegistry, ectx.model)
			: ectx.model);

	const result: StepResult = {
		label: step.label,
		status: "running",
		output: "",
		elapsed: 0,
		toolCount: (step.tools ?? ["read", "bash", "edit", "write"]).length,
		toolCallCount: 0,
		model: resolvedModel.id,
	};

	try {
		const core = await runStepCore(
			step,
			input,
			original,
			ectx,
			resolvedModel,
			warmSession,
		);
		result.status = core.status;
		result.output = core.output;
		result.gateResult = core.gateResult;
		result.error = core.error;
		result.toolCallCount = core.toolCallCount;
	} catch (err) {
		result.status = "failed";
		result.error = err instanceof Error ? err.message : String(err);
		result.output = `Error: ${result.error}`;
	}

	result.elapsed = Date.now() - start;
	if (ectx.stepGroup) result.group = ectx.stepGroup;
	ectx.onStepEnd?.(result);

	// Apply transform if present
	const transformedOutput = await applyStepTransform(
		step.transform,
		result.output,
		ectx,
		original,
	);

	return { output: transformedOutput, results: [result] };
}

// ── Step Failure Handling ─────────────────────────────────────────────────

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
	if (!onFail)
		return { status: "failed", output: lastOutput, error: gateResult.reason };
	const decision = await onFail({
		reason: gateResult.reason,
		retryCount,
		stepCount: retryCount + 1,
		output: lastOutput,
	});

	switch (decision.action) {
		case "retry": {
			if (retryCount >= MAX_EXECUTOR_RETRIES) {
				console.warn(
					`[captain] handleFailure: hard retry cap (${MAX_EXECUTOR_RETRIES}) reached for step "${step.label}". Forcing fail.`,
				);
				return {
					status: "failed",
					output: lastOutput,
					error: `Gate failed after ${MAX_EXECUTOR_RETRIES} retries (executor hard cap): ${gateResult.reason}`,
				};
			}
			const retryPrompt = `${step.prompt}\n\n[RETRY ${retryCount + 1}: Previous attempt failed gate: ${gateResult.reason}]\n\nPrevious output:\n${lastOutput.slice(0, 1000)}`;
			// Strip gate/onFail — the gate is re-evaluated here, in the outer loop.
			const retryStep: Step = {
				...step,
				prompt: retryPrompt,
				gate: undefined,
				onFail: undefined,
			};
			const { output: retryOutput } = await executeStep(
				retryStep,
				input,
				original,
				ectx,
			);
			const retryGateResult = step.gate
				? await runGate(step.gate, retryOutput, makeGateCtx(ectx))
				: { passed: true, reason: "No gate" };
			if (retryGateResult.passed)
				return { status: "passed", output: retryOutput };
			return handleFailure(
				step,
				input,
				original,
				retryOutput,
				retryGateResult,
				ectx,
				retryCount + 1,
			);
		}

		case "fail":
			return {
				status: "failed",
				output: lastOutput,
				error: `Gate failed: ${gateResult.reason}`,
			};

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
				{ ...decision.step, kind: "step" },
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

// ── Helper Functions ───────────────────────────────────────────────────────

/** Build a GateCtx from an ExecutorContext (without step-specific fields like toolsUsed). */
export function makeGateCtx(ectx: ExecutorContext): GateCtx {
	return {
		cwd: ectx.cwd,
		signal: ectx.signal,
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
	};
}

function interpolatePrompt(
	template: string,
	input: string,
	original: string,
): string {
	return template.replace(/\$INPUT/g, input).replace(/\$ORIGINAL/g, original);
}

/**
 * Apply a transform function to output text for steps.
 */
async function applyStepTransform(
	transform: Transform | undefined,
	output: string,
	ectx: ExecutorContext,
	original = "",
): Promise<string> {
	if (!transform) return output;

	return transform({ output, original, ctx: makeGateCtx(ectx) });
}
