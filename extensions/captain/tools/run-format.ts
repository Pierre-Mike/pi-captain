// ── tools/run-format.ts — Output formatting and step hook builders ──────────
// Extracted from run-helpers.ts to stay within 200-line limit.

import * as piSdk from "@mariozechner/pi-coding-agent";
import type { PipelineState, StepResult } from "../core/types.js";
import type { ExecutorContext } from "../shell/executor.js";
import type { ExecCtx } from "./run-helpers.js";

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
