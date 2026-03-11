// ── Recursive Pipeline Execution Engine ────────────────────────────────────
// Each Step runs via the pi SDK (createAgentSession) — no subprocess needed.

/**
 * Hard ceiling on retry attempts enforced by the executor, regardless of what
 * the user-supplied onFail function returns. Prevents infinite loops when an
 * inline onFail always returns { action: "retry" } with no exit condition.
 *
 * Individual steps / containers can set a lower limit via their onFail logic
 * (e.g. retry(3)), but the executor will never exceed this absolute cap.
 */
const MAX_EXECUTOR_RETRIES = 10;

import { appendFileSync } from "node:fs";

const _captainDebug = (msg: string) => {
	if (process.env.CAPTAIN_DEBUG) appendFileSync("/tmp/captain-debug.log", msg);
};

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
import { type GateResult, runGate } from "./gates.js";
import type { MergeCtx } from "./merge.js";
import type {
	Gate,
	GateCtx,
	OnFail,
	Parallel,
	Pool,
	Runnable,
	Sequential,
	Step,
	StepResult,
	Transform,
} from "./types.js";
import { createWorktree, isGitRepo, removeWorktree } from "./worktree.js";

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
	 * Fix 1: Shared loader cache for the lifetime of one pipeline run.
	 * Keys are JSON-serialised loader config (cwd + agentDir + systemPrompt +
	 * extensions + skills).  Steps that share the same config reuse the already-
	 * reloaded loader instead of hitting the disk on every step.
	 */
	loaderCache?: Map<string, DefaultResourceLoader>;
	/**
	 * Fix 2: Pre-resolved git-repo flag for the current cwd.
	 * Set once before spawning parallel branches so every branch skips its own
	 * `git rev-parse` subprocess.
	 */
	isGitRepo?: boolean;
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

/** Returns true if the model ID looks like a dated snapshot (e.g. claude-sonnet-4-5-20250929). */
function isDatedModel(id: string): boolean {
	return /\d{8}$/.test(id);
}

/**
 * Score a model ID for sorting: higher = better (more current, preferred).
 * Ranking strategy (Anthropic-style):
 *   1. New-style alias with no date  e.g. claude-sonnet-4-5         → score 3
 *   2. New-style dated snapshot      e.g. claude-sonnet-4-5-20250929 → score 2
 *   3. Old-style alias               e.g. claude-3-7-sonnet-latest   → score 1
 *   4. Old-style dated snapshot      e.g. claude-3-5-sonnet-20240620 → score 0
 *
 * "New-style" = matches `claude-<name>-<digit>` (no "3-N-" prefix).
 */
function modelScore(id: string): number {
	const lower = id.toLowerCase();
	// New-style: "claude-" then a word, then a digit version — NOT "claude-3-"
	const isNewStyle = /^claude-(?!\d)/.test(lower);
	const dated = isDatedModel(lower);
	if (isNewStyle && !dated) return 3;
	if (isNewStyle && dated) return 2;
	if (!(isNewStyle || dated)) return 1;
	return 0;
}

/** Resolve a model identifier string (e.g. "sonnet") to a Model object via the registry.
 * Prefers models from the same provider as the fallback (current session model) to avoid
 * accidentally resolving to Amazon Bedrock or other providers when multiple providers
 * have models with the same ID.
 * Among partial matches, ranks by modelScore so that `model: "sonnet"` resolves to
 * the most current available alias (e.g. `claude-sonnet-4-5`) rather than an old dated
 * snapshot (`claude-3-5-sonnet-20240620`) or a deprecated `-latest` alias. */
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

	// 2. Partial match within same provider (name or id), ranked by modelScore.
	const partialMatches = all.filter(
		(m) =>
			sameProvider(m) &&
			(m.id.toLowerCase().includes(lower) ||
				(m as { name?: string }).name?.toLowerCase().includes(lower)),
	);
	if (partialMatches.length > 0) {
		partialMatches.sort((a, b) => modelScore(b.id) - modelScore(a.id));
		return partialMatches[0];
	}

	// 3. No match in current provider — fall back to session model to avoid
	//    accidentally resolving to a different provider (e.g. Amazon Bedrock)
	//    that the user may not have credentials for.
	return fallback;
}

// ── Fix 1: loader cache helper ────────────────────────────────────────────
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
type WarmSession = {
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
function prefetchSession(
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

/** Resolve agent, create an SDK session, run the prompt, evaluate gate, apply transform. */
async function runStepCore(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
	/** Fix 3: pre-resolved model from executeStep — avoids a second registry scan */
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

	// Fix 3: model is pre-resolved by executeStep — use it directly.
	const model = resolvedModel;

	// ── Resolve tools ────────────────────────────────────────────────────
	const toolNames = step.tools ?? ["read", "bash", "edit", "write"];

	// ── Obtain session — prefetched (warm) or cold-start ─────────────────
	// If a warm session was pre-created while the previous step was running,
	// use it directly — skipping createAgentSession and loader work entirely.
	// Otherwise fall back to the normal cold-start path.
	let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
	if (warmSession) {
		session = warmSession.session;
	} else {
		const tools = resolveTools(toolNames, ectx.cwd);
		// Fix 1: reuse cached loader when config matches a previous step.
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

	// ── Activate extension tools (e.g. web_search) ───────────────────────
	// resolveTools() only builds AgentTool[] for built-in tools. Extension tools
	// (registered via the resourceLoader/extensions) are loaded but not active by
	// default. Calling setActiveToolsByName with ALL tool names from the step spec
	// activates any extension tools (like web_search) that the resource loader
	// registered. Unknown tool names are silently ignored by the SDK.
	// This is called on both warm (prefetched) and cold sessions — it is safe to
	// call multiple times and is intentional: the prefetch path wires built-in
	// tools, but extension tools may only be available after the loader is attached.
	session.setActiveToolsByName(toolNames);

	// Wire abort signal → session.abort()
	const onAbort = () => session.abort();
	ectx.signal?.addEventListener("abort", onAbort);

	// Collect text output from streaming events.
	// Also capture tool results so that steps relying on tool output (e.g. bash
	// researchers) always produce non-empty output even when the model ends its
	// turn on a tool call without a trailing text summary.
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

	// Fix 5: await dispose so the session is fully torn down before we proceed.
	await session.dispose();

	const gateCtx = {
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		cwd: ectx.cwd,
		signal: ectx.signal,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
		toolsUsed,
	};

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
		const transformed = await applyTransform(
			step.transform,
			failResult.output,
			ectx,
			original,
		);
		return {
			...failResult,
			output: transformed,
			gateResult,
			toolCallCount,
		};
	}

	const transformed = await applyTransform(
		step.transform,
		output,
		ectx,
		original,
	);
	return {
		status: "passed",
		output: transformed,
		gateResult,
		toolCallCount,
	};
}

async function executeStep(
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
		// Fix 3: pass the already-resolved model so runStepCore skips a second registry scan.
		// Also pass the warm session if available — runStepCore will use it directly.
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

	return { output: result.output, results: [result] };
}

// ── Shared Gate + OnFail for Composition Nodes ────────────────────────────

// OnFail coverage in gateCheck (container-level gate failures — sequential, pool, parallel):
// OnFail is now a function (ctx) => OnFailResult. Decision is evaluated per failure.
// retry ✓  retryWithDelay ✓  fail ✓  skip ✓  warn ✓  fallback ✓
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
	if (!gate) return { output, results };

	const gateResult = await runGate(gate, output, {
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

	const decision = await onFail({
		reason: gateResult.reason,
		retryCount,
		stepCount: retryCount + 1,
		output,
	});

	switch (decision.action) {
		case "retry": {
			if (retryCount >= MAX_EXECUTOR_RETRIES) {
				gateStepResult.status = "failed";
				gateStepResult.error = `Gate failed after ${MAX_EXECUTOR_RETRIES} retries (executor hard cap): ${gateResult.reason}`;
				console.warn(
					`[captain] gateCheck: hard retry cap (${MAX_EXECUTOR_RETRIES}) reached for "${scopeLabel}". Forcing fail.`,
				);
				return { output, results: [...results, gateStepResult] };
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

		case "fail":
			gateStepResult.error = `Gate failed: ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "skip":
			gateStepResult.status = "skipped";
			gateStepResult.error = `Skipped: ${gateResult.reason}`;
			return { output: "", results: [...results, gateStepResult] };

		case "warn":
			gateStepResult.status = "passed";
			gateStepResult.error = `⚠️ Warning (gate failed but continued): ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "fallback": {
			const fallbackResult = await executeStep(
				{ ...decision.step, kind: "step" },
				output,
				output,
				ectx,
			);
			return {
				output: fallbackResult.output,
				results: [...results, gateStepResult, ...fallbackResult.results],
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

	// ── 1-step lookahead prefetch ─────────────────────────────────────────
	// While step[i]'s prompt is running (blocking on the LLM), we fire off
	// createAgentSession for step[i+1] in the background. By the time step[i]
	// finishes and we know $INPUT, the session for step[i+1] is already warm.
	// Prefetch is opportunistic: errors are swallowed and fall back to cold-start.
	// Only applied to direct `kind: "step"` children — nested pipelines are opaque.

	/** Kick off a background session creation for `step`, or return null if
	 *  the step isn't a plain Step (nested sequential/pool/parallel). */
	const startPrefetch = (runnable: Runnable): Promise<WarmSession | null> =>
		runnable.kind === "step"
			? prefetchSession(runnable as Step, ectx)
			: Promise.resolve(null);

	// Pre-warm the session for the very first step immediately.
	let nextPrefetch: Promise<WarmSession | null> =
		seq.steps.length > 0 ? startPrefetch(seq.steps[0]) : Promise.resolve(null);

	for (let i = 0; i < seq.steps.length; i++) {
		if (ectx.signal?.aborted) {
			// Pipeline cancelled — dispose any pending prefetch to avoid leaking sessions.
			nextPrefetch.then((w) => w?.session.dispose()).catch(() => {});
			break;
		}

		const runnable = seq.steps[i];

		// Await the pre-warmed session for THIS step (created during the previous step).
		const warm = await nextPrefetch;

		// Immediately kick off prefetch for the NEXT step — runs concurrently
		// with this step's LLM call, which is the long part.
		nextPrefetch =
			i + 1 < seq.steps.length
				? startPrefetch(seq.steps[i + 1])
				: Promise.resolve(null);

		// Run the current step, handing it the warm session.
		const { output, results } =
			runnable.kind === "step"
				? await executeStep(
						runnable as Step,
						currentInput,
						original,
						ectx,
						warm,
					)
				: await executeRunnable(runnable, currentInput, original, ectx);
		// ↑ warm session is unused for nested runnables; it was null anyway.

		allResults.push(...results);
		currentInput = output;

		const lastResult = results.at(-1);
		if (lastResult?.status === "failed") {
			// Step failed — dispose any pending prefetch before bailing.
			nextPrefetch.then((w) => w?.session.dispose()).catch(() => {});
			break;
		}
	}

	const checked = await gateCheck(
		currentInput,
		allResults,
		seq.gate,
		seq.onFail,
		`sequential (${seq.steps.length} steps)`,
		() => executeSequential(seq, input, original, ectx),
		ectx,
		0,
	);
	if (seq.transform) {
		checked.output = await applyTransform(
			seq.transform,
			checked.output,
			ectx,
			original,
		);
	}
	return checked;
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
		// Fix 2: resolve git-repo status once for this cwd, reuse for all branches.
		const gitRepo = ectx.isGitRepo ?? (await isGitRepo(ectx.exec, ectx.cwd));

		const poolGroup = `pool ×${pool.count}: ${getLabel(pool.step) || "step"}`;
		const promises = Array.from({ length: pool.count }, async (_, i) => {
			const label = getLabel(pool.step) || `pool-${i}`;
			const wt = await createWorktree(
				ectx.exec,
				ectx.cwd,
				ectx.pipelineName,
				label,
				i,
				ectx.signal,
				gitRepo,
			);
			if (wt) worktrees.push({ path: wt.worktreePath, branch: wt.branchName });
			const branchCtx: ExecutorContext = {
				...ectx,
				cwd: wt?.worktreePath ?? ectx.cwd,
				stepGroup: poolGroup,
			};
			// Tag each pool instance with its index so they get unique labels in
			// currentSteps/results — without this all N instances share one label
			// and the Set collapses them into a single entry.
			const taggedStep =
				pool.count > 1 && pool.step.kind === "step"
					? { ...pool.step, label: `${pool.step.label} [${i + 1}]` }
					: pool.step;
			return executeRunnable(
				taggedStep,
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

		const mctx: MergeCtx = {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		};
		const merged = await pool.merge(outputs, mctx);
		const checked = await gateCheck(
			merged,
			allResults,
			pool.gate,
			pool.onFail,
			`pool ×${pool.count}`,
			() => executePool(pool, input, original, ectx),
			ectx,
			0,
		);
		if (pool.transform) {
			checked.output = await applyTransform(
				pool.transform,
				checked.output,
				ectx,
				original,
			);
		}
		return checked;
	} finally {
		// Fix 4: remove all worktrees in parallel instead of sequentially.
		await Promise.all(
			worktrees.map((wt) =>
				removeWorktree(ectx.exec, ectx.cwd, wt.path, wt.branch, ectx.signal),
			),
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
		// Fix 2: resolve git-repo status once for this cwd, reuse for all branches.
		const gitRepo = ectx.isGitRepo ?? (await isGitRepo(ectx.exec, ectx.cwd));

		const parGroup = `parallel ×${par.steps.length}`;
		const promises = par.steps.map(async (step, i) => {
			const label = getLabel(step) || `parallel-${i}`;
			const wt = await createWorktree(
				ectx.exec,
				ectx.cwd,
				ectx.pipelineName,
				label,
				i,
				ectx.signal,
				gitRepo,
			);
			if (wt) worktrees.push({ path: wt.worktreePath, branch: wt.branchName });
			const branchCtx: ExecutorContext = {
				...ectx,
				cwd: wt?.worktreePath ?? ectx.cwd,
				stepGroup: parGroup,
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

		const mctx: MergeCtx = {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		};
		const merged = await par.merge(outputs, mctx);
		const checked = await gateCheck(
			merged,
			allResults,
			par.gate,
			par.onFail,
			`parallel (${par.steps.length} branches)`,
			() => executeParallel(par, input, original, ectx),
			ectx,
			0,
		);
		if (par.transform) {
			checked.output = await applyTransform(
				par.transform,
				checked.output,
				ectx,
				original,
			);
		}
		return checked;
	} finally {
		// Fix 4: remove all worktrees in parallel instead of sequentially.
		await Promise.all(
			worktrees.map((wt) =>
				removeWorktree(ectx.exec, ectx.cwd, wt.path, wt.branch, ectx.signal),
			),
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
	original = "",
): Promise<string> {
	const ctx: GateCtx = {
		cwd: ectx.cwd,
		signal: ectx.signal,
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
	};
	return transform({ output, original, ctx });
}

// OnFail coverage in handleFailure (step-level gate failures):
// OnFail is now a function (ctx) => OnFailResult. Decision is evaluated per failure.
// retry ✓  retryWithDelay ✓  fail ✓  skip ✓  warn ✓  fallback ✓
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
				? await runGate(step.gate, retryOutput, {
						exec: ectx.exec,
						confirm: ectx.confirm,
						hasUI: ectx.hasUI,
						cwd: ectx.cwd,
						signal: ectx.signal,
						model: ectx.model,
						apiKey: ectx.apiKey,
						modelRegistry: ectx.modelRegistry,
					})
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
