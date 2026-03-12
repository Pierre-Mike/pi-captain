// ── tools/run-helpers.ts — Pipeline execution context builders ────────────
// Extracted from run.ts to stay within 200-line limit (Basic_knowledge.md).

import type {
	DefaultResourceLoader,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import * as piSdk from "@mariozechner/pi-coding-agent";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { PipelineState, StepResult } from "../types.js";
import { text } from "./helpers.js";

export type ExecCtx = ExtensionContext;

/** Build the lifecycle hooks that update the pipeline widget on each step event. */
export function makeStepHooks(
	pipelineState: PipelineState,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
): Pick<
	ExecutorContext,
	"onStepStart" | "onStepStream" | "onStepEnd" | "onStepToolCall"
> {
	return {
		onStepStart: (label) => {
			pipelineState.currentSteps.add(label);
			pipelineState.currentStepStreams.delete(label);
			pipelineState.currentStepToolCalls.delete(label);
			updateWidget(ctx, pipelineState);
		},
		onStepStream: (label, streamText) => {
			pipelineState.currentStepStreams.set(label, streamText);
			updateWidget(ctx, pipelineState);
		},
		onStepToolCall: (label, totalCalls) => {
			pipelineState.currentStepToolCalls.set(label, totalCalls);
			updateWidget(ctx, pipelineState);
		},
		onStepEnd: (result: StepResult) => {
			pipelineState.currentSteps.delete(result.label);
			pipelineState.currentStepStreams.delete(result.label);
			pipelineState.currentStepToolCalls.delete(result.label);
			pipelineState.results.push(result);
			updateWidget(ctx, pipelineState);
		},
	};
}

/** Assemble the ExecutorContext for a pipeline run. */
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

/** Run a pipeline and return tool content result. */
export async function runPipeline(
	pi: ExtensionAPI,
	state: CaptainState,
	resolvedName: string,
	resolvedInput: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx) => void,
	buildCompletionText: (
		name: string,
		output: string,
		results: StepResult[],
		start?: number,
		end?: number,
	) => string,
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
	state.runningState = pipelineState;
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

	try {
		const { output, results } = await executeRunnable(
			pipeline.spec,
			inputStr,
			inputStr,
			ectx,
		);
		pipelineState.status = "completed";
		pipelineState.finalOutput = output;
		pipelineState.endTime = Date.now();
		pipelineState.results = results;
		clearWidget(ctx);
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
		pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		clearWidget(ctx);
		return {
			content: [
				text(
					`Pipeline "${resolvedName}" failed: ${err instanceof Error ? err.message : String(err)}`,
				),
			],
			details: undefined,
		};
	}
}

// ── Output formatter ─────────────────────────────────────────────────────
export function buildCompletionText(
	name: string,
	output: string,
	results: StepResult[],
	startTime: number | undefined,
	endTime: number | undefined,
): string {
	const end = endTime ?? Date.now();
	const elapsed = ((end - (startTime ?? end)) / 1000).toFixed(1);
	const passed = results.filter((r) => r.status === "passed").length;
	const failed = results.filter((r) => r.status === "failed").length;
	const skipped = results.filter((r) => r.status === "skipped").length;
	const { content: truncated } = piSdk.truncateHead(output, {
		maxLines: piSdk.DEFAULT_MAX_LINES,
		maxBytes: piSdk.DEFAULT_MAX_BYTES,
	});
	return [
		`Pipeline "${name}" completed in ${elapsed}s`,
		`Steps: ${results.length} (${passed} passed, ${failed} failed, ${skipped} skipped)`,
		"── Output ──",
		truncated,
	].join("\n");
}
