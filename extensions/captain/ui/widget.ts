// ── Captain Pipeline Progress Widget ─────────────────────────────────────

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { PipelineState, StepResult } from "../types.js";

/** Map step status to theme color name */
export function statusColor(status: string): string {
	if (status === "passed") return "success";
	if (status === "failed") return "error";
	if (status === "running") return "accent";
	return "dim";
}

/** Map step status to a single visual icon */
export function statusDot(status: string): string {
	if (status === "passed") return "✓";
	if (status === "failed") return "✗";
	if (status === "skipped") return "⊘";
	if (status === "running") return "●";
	return "○";
}

/** Pick the trailing detail text for a step (last stream line or error) */
function stepDetail(r: StepResult): string {
	if (r.output)
		return (
			r.output
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? ""
		);
	return r.error ?? "";
}

/** Truncate a detail string to fit available width */
function truncateDetail(detail: string, available: number): string {
	if (!detail || available <= 6) return "";
	return detail.length > available
		? `${detail.slice(0, available - 3)}...`
		: detail;
}

/** Render one step as a compact single line */
function renderStepLine(
	r: StepResult,
	width: number,
	indent: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string {
	const pad = " ".repeat(indent);
	const dot = theme.fg(statusColor(r.status), statusDot(r.status));
	const name = theme.fg(r.status === "running" ? "accent" : "dim", r.label);
	const timeStr = r.elapsed > 0 ? ` ${(r.elapsed / 1000).toFixed(1)}s` : "";
	const time = timeStr ? theme.fg("dim", timeStr) : "";
	const fixedLen = indent + 2 + r.label.length + timeStr.length;
	const detailTrunc = truncateDetail(stepDetail(r), width - fixedLen - 2);
	const detail = detailTrunc ? theme.fg("muted", `  ${detailTrunc}`) : "";
	return truncateToWidth(`${pad}${dot} ${name}${time}${detail}`, width);
}

/** Append one step's line to output, emit a group header if needed. Returns current group. */
function appendStepLine(
	lines: string[],
	r: StepResult,
	lastGroup: string | undefined,
	width: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string | undefined {
	let currentGroup = lastGroup;
	if (r.group && r.group !== lastGroup) {
		lines.push(theme.fg("dim", `  ┬ ${r.group}`));
		currentGroup = r.group;
	} else if (!r.group) {
		currentGroup = undefined;
	}
	if (r.group) {
		lines.push(
			`${theme.fg("dim", "  │")}${renderStepLine(r, width - 3, 1, theme)}`,
		);
	} else {
		lines.push(renderStepLine(r, width, 2, theme));
	}
	return currentGroup;
}

/** Render all steps as compact lines, grouping parallel/pool under a header */
export function renderStepList(
	results: StepResult[],
	currentSteps: Set<string>,
	currentStepStreams: Map<string, string>,
	width: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string[] {
	const runningSteps: StepResult[] = [...currentSteps].map((label) => {
		const stream = currentStepStreams.get(label) ?? "";
		const streamTail =
			stream
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? "";
		return {
			label,
			status: "running" as const,
			output: streamTail,
			elapsed: 0,
		};
	});
	const all: StepResult[] = [...results, ...runningSteps];

	if (all.length === 0) return [theme.fg("dim", "  Waiting for steps...")];

	const lines: string[] = [];
	let lastGroup: string | undefined;
	for (const r of all) {
		lastGroup = appendStepLine(lines, r, lastGroup, width, theme);
	}
	return lines;
}

/** Update the live widget showing pipeline progress */
export function updateWidget(ctx: ExtensionContext, state: PipelineState) {
	ctx.ui.setWidget("captain", (_tui, theme) => {
		const text = new Text("", 0, 1);
		return {
			render(width: number): string[] {
				const elapsed = state.startTime
					? ((Date.now() - state.startTime) / 1000).toFixed(1)
					: "0";
				const headerLabel = `  Captain: ${state.name}`;
				const headerRight = `${elapsed}s `;
				const headerPad = " ".repeat(
					Math.max(1, width - headerLabel.length - headerRight.length),
				);
				const header =
					theme.fg("accent", theme.bold(headerLabel)) +
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

/** Clear the pipeline widget (with a brief delay so user can see final state) */
export function clearWidget(ctx: ExtensionContext) {
	setTimeout(() => ctx.ui.setWidget("captain", undefined), 3000);
}
