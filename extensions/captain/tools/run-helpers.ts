// ── tools/run-helpers.ts — Pipeline execution context builders ────────────

import type {
	DefaultResourceLoader,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { PipelineState, StepResult } from "../core/types.js";
import type { ExecutorContext } from "../shell/executor.js";
import { executeRunnable } from "../shell/executor.js";
import type { CaptainState } from "../state.js";
import { text } from "./helpers.js";
import { makeStepHooks, writePipelineLog } from "./run-format.js";

export type ExecCtx = ExtensionContext;
export { buildCompletionText } from "./run-format.js";
export function buildEctx(
	pi: ExtensionAPI,
	pipelineState: PipelineState,
	resolvedName: string,
	apiKey: string,
	signal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
): ExecutorContext {
	return {
		exec: (cmd, args, opts) => pi.exec(cmd, [...args], opts),
		model: ctx.model as NonNullable<typeof ctx.model>,
		modelRegistry: ctx.modelRegistry,
		apiKey,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
		signal: signal ?? undefined,
		pipelineName: resolvedName,
		loaderCache: new Map<string, DefaultResourceLoader>(),
		...makeStepHooks(pipelineState, ctx, updateWidget),
	};
}
function mergeSignals(
	a: AbortSignal | undefined,
	b: AbortSignal | undefined,
): AbortSignal | undefined {
	if (!(a || b)) return undefined;
	if (!a) return b;
	if (!b) return a;
	return AbortSignal.any([a, b]);
}
export async function runPipeline(
	pi: ExtensionAPI,
	state: CaptainState,
	resolvedName: string,
	resolvedInput: string | undefined,
	toolSignal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx, s: PipelineState) => void,
	buildCompletionText: (
		name: string,
		output: string,
		results: StepResult[],
		start?: number,
		end?: number,
	) => string,
	background = false,
): Promise<{ content: { type: "text"; text: string }[]; details: undefined }> {
	const pipeline = state.pipelines[resolvedName];
	if (!pipeline)
		return {
			content: [text(`Error: pipeline "${resolvedName}" not found.`)],
			details: undefined,
		};

	const pipelineState: PipelineState = {
		name: resolvedName,
		spec: pipeline.spec,
		status: "running",
		results: [],
		currentSteps: new Set(),
		currentStepStreams: new Map(),
		currentStepToolCalls: new Map(),
		startTime: Date.now(),
	};

	// Allocate a job (owns its AbortController for independent kill).
	const job = state.allocateJob(pipelineState);
	// For background runs, ignore the tool signal; for blocking, merge both signals.
	const signal = background
		? job.controller.signal
		: mergeSignals(toolSignal, job.controller.signal);

	updateWidget(ctx, pipelineState);

	if (!ctx.model)
		return { content: [text("Error: no model available")], details: undefined };
	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey)
		return {
			content: [text("Error: no API key available")],
			details: undefined,
		};

	const inputStr = resolvedInput ?? "";
	const ectx = buildEctx(
		pi,
		pipelineState,
		resolvedName,
		apiKey,
		signal,
		ctx,
		updateWidget,
	);

	const runPromise = executeRunnable(pipeline.spec, inputStr, inputStr, ectx);

	// ── Background: fire and return immediately ──────────────────────────
	if (background) {
		runPromise
			.then(({ output, results }) => {
				if (pipelineState.status !== "cancelled") {
					pipelineState.status = "completed";
					pipelineState.finalOutput = output;
					pipelineState.results = results;
				}
				pipelineState.endTime = Date.now();
				writePipelineLog(ctx.cwd, pipelineState);
				clearWidget(ctx, pipelineState);
			})
			.catch(() => {
				if (pipelineState.status !== "cancelled")
					pipelineState.status = "failed";
				pipelineState.endTime = Date.now();
				writePipelineLog(ctx.cwd, pipelineState);
				clearWidget(ctx, pipelineState);
			});

		return {
			content: [
				text(
					[
						`Pipeline "${resolvedName}" started as job #${job.id}.`,
						`Check progress: captain_status { "name": "${resolvedName}" }`,
						`Kill:           captain_kill { "id": ${job.id} }`,
					].join("\n"),
				),
			],
			details: undefined,
		};
	}

	// ── Blocking: wait for completion ────────────────────────────────────
	try {
		const { output, results } = await runPromise;
		if (pipelineState.status === "cancelled") {
			clearWidget(ctx, pipelineState);
			return {
				content: [
					text(`Pipeline "${resolvedName}" (job #${job.id}) was killed.`),
				],
				details: undefined,
			};
		}
		pipelineState.status = "completed";
		pipelineState.finalOutput = output;
		pipelineState.endTime = Date.now();
		pipelineState.results = results;
		writePipelineLog(ctx.cwd, pipelineState);
		clearWidget(ctx, pipelineState);
		return {
			content: [
				text(
					buildCompletionText(
						resolvedName,
						output,
						results,
						pipelineState.startTime,
						pipelineState.endTime,
					),
				),
			],
			details: undefined,
		};
	} catch (err) {
		const wasCancelled = pipelineState.status === "cancelled";
		if (!wasCancelled) pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		writePipelineLog(ctx.cwd, pipelineState);
		clearWidget(ctx, pipelineState);
		return {
			content: [
				text(
					wasCancelled
						? `Pipeline "${resolvedName}" (job #${job.id}) was killed.`
						: `Pipeline "${resolvedName}" failed: ${err instanceof Error ? err.message : String(err)}`,
				),
			],
			details: undefined,
		};
	}
}
