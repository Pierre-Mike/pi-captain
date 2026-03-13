// ── ui/widget.ts — Pipeline progress widget (renderStepList, updateWidget, clearWidget)
// Pure rendering helpers split into widget-render.ts and widget-pending.ts
// to stay within the 200-line limit (Basic_knowledge.md).

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { PipelineState, Runnable, StepResult } from "../core/types.js";
import {
	appendPendingLine,
	appendStepLine,
	buildLabelSpecMap,
	computePendingSteps,
} from "./widget-pending.js";
import { renderStepLines, statusColor, statusDot } from "./widget-render.js";

export { statusColor, statusDot };

export function renderStepList(
	results: StepResult[],
	currentSteps: Set<string>,
	currentStepStreams: Map<string, string>,
	currentStepToolCalls: Map<string, number>,
	spec: Runnable,
	width: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string[] {
	const labelSpecMap = buildLabelSpecMap(spec);
	const runningSteps: StepResult[] = [...currentSteps].map((label) => {
		const stream = currentStepStreams.get(label) ?? "";
		const streamTail =
			stream
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? "";
		const existingResult = results.findLast((r) => r.label === label);
		const specMeta = labelSpecMap.get(label);
		return {
			label,
			status: "running" as const,
			output: streamTail,
			elapsed: 0,
			toolCount: existingResult?.toolCount ?? specMeta?.toolCount,
			toolCallCount: currentStepToolCalls.get(label) ?? 0,
			model: existingResult?.model ?? specMeta?.model,
			group: existingResult?.group ?? specMeta?.group,
		};
	});

	const active: StepResult[] = [...results, ...runningSteps];
	const pending = computePendingSteps(spec, results, currentSteps);
	if (active.length === 0 && pending.length === 0)
		return [theme.fg("dim", "  Waiting for steps...")];

	const lines: string[] = [];
	let lastGroup: string | undefined;
	for (const r of active) {
		lastGroup = appendStepLine(lines, r, lastGroup, width, theme);
	}
	for (const entry of pending) {
		lastGroup = appendPendingLine(lines, entry, lastGroup, width, theme);
	}
	return lines;
}

function widgetKey(state: PipelineState): string {
	return `captain-${state.jobId ?? 0}`;
}

export function updateWidget(ctx: ExtensionContext, state: PipelineState) {
	ctx.ui.setWidget(widgetKey(state), (_tui, theme) => {
		const text = new Text("", 0, 1);
		return {
			render(width: number): string[] {
				const elapsed = state.startTime
					? ((Date.now() - state.startTime) / 1000).toFixed(1)
					: "0";
				const jobId = state.jobId !== undefined ? ` #${state.jobId}` : "";
				const headerLabel = `  Captain: ${state.name}${jobId}`;
				const killHint =
					state.jobId !== undefined ? `  /captain-kill ${state.jobId}` : "";
				const headerRight = `${elapsed}s `;
				const headerPad = " ".repeat(
					Math.max(
						1,
						width - headerLabel.length - killHint.length - headerRight.length,
					),
				);
				const header =
					theme.fg("accent", theme.bold(headerLabel)) +
					theme.fg("dim", killHint) +
					headerPad +
					theme.fg("dim", headerRight);
				const lines: string[] = [
					theme.fg("accent", "─".repeat(width)),
					truncateToWidth(header, width),
					theme.fg("accent", "─".repeat(width)),
					...renderStepList(
						state.results,
						state.currentSteps,
						state.currentStepStreams,
						state.currentStepToolCalls,
						state.spec,
						width,
						theme,
					),
				];
				text.setText(lines.join("\n"));
				return text.render(width);
			},
			invalidate() {
				text.invalidate();
			},
		};
	});
}

export function clearWidget(ctx: ExtensionContext, state: PipelineState) {
	const key = widgetKey(state);
	setTimeout(() => ctx.ui.setWidget(key, undefined), 5000);
}

export { renderStepLines };
