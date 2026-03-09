// ── Recursive Pipeline Execution Engine ────────────────────────────────────
// Each Step runs via the pi SDK (createAgentSession) — no subprocess needed.

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
	type Tool,
} from "@mariozechner/pi-coding-agent";
import { type GateResult, runGate } from "./gates.js";
import { mergeOutputs } from "./merge.js";
import type {
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
	pipelineName: string;
	/** Group label for steps running inside a parallel/pool — set by the executor */
	stepGroup?: string;
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
	const prompt = interpolatePrompt(step.prompt, input, original);

	// ── Resolve model ────────────────────────────────────────────────────
	// Default to the current session model (ectx.model) when no model is specified.
	const model = step.model
		? resolveModel(step.model, ectx.modelRegistry, ectx.model)
		: ectx.model;

	// ── Resolve tools ────────────────────────────────────────────────────
	const toolNames = step.tools ?? ["read", "bash", "edit", "write"];
	const tools = resolveTools(toolNames, ectx.cwd);

	// ── Build resource loader (skills, extensions, system prompt) ────────
	const systemPrompt = step.systemPrompt;

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
		...(step.temperature !== undefined && { temperature: step.temperature }),
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
			ectx.onStepStream?.(step.label, output);
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

	const gateCtx = {
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		cwd: ectx.cwd,
		signal: ectx.signal,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
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
		return { ...failResult, output: transformed, gateResult };
	}

	const transformed = await applyTransform(
		step.transform,
		output,
		ectx,
		original,
	);
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
		toolCount: (step.tools ?? ["read", "bash", "edit", "write"]).length,
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

		const merged = await mergeOutputs(pool.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});
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

		const merged = await mergeOutputs(par.merge.strategy, outputs, {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		});
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
