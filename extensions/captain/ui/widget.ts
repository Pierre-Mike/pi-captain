// ── Captain Pipeline Progress Widget ─────────────────────────────────────

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { PipelineState, Runnable, StepResult } from "../types.js";

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

/**
 * Shorten a full model ID to a readable label.
 * e.g. "claude-sonnet-4-5" → "sonnet 4.5"
 *      "claude-haiku-4-5-20250929" → "haiku 4.5"
 *      "gpt-4o" → "gpt-4o"
 */
function shortenModelId(id: string): string {
	const m = id.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/i);
	if (m) return `${m[1]} ${m[2]}.${m[3]}`;
	return id.replace(/^claude-/i, "");
}

/**
 * Render one step as a single line:
 *   ● name  model  🔨 2/4  1.2s  detail…
 */
function renderStepLines(
	r: StepResult,
	width: number,
	indent: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string[] {
	const pad = " ".repeat(indent);

	const dot = theme.fg(statusColor(r.status), statusDot(r.status));
	const name = theme.fg(r.status === "running" ? "accent" : "dim", r.label);

	// model badge
	const modelRaw = r.model ? shortenModelId(r.model) : "";
	const model = modelRaw ? `  ${theme.fg("dim", modelRaw)}` : "";

	// 🔨 callsMade/toolsAvailable  (or just 🔨 N if only available is known)
	let hammerRaw = "";
	if (r.toolCount !== undefined) {
		const calls = r.toolCallCount ?? 0;
		hammerRaw = `🔨 ${calls}/${r.toolCount}`;
	}
	const hammer = hammerRaw ? `  ${theme.fg("dim", hammerRaw)}` : "";

	// elapsed time
	const timeRaw = r.elapsed > 0 ? `${(r.elapsed / 1000).toFixed(1)}s` : "";
	const time = timeRaw ? `  ${theme.fg("dim", timeRaw)}` : "";

	// fixed-width portion (no ANSI) for available-width calculation
	const fixedLen =
		indent +
		2 +
		r.label.length +
		(modelRaw ? 2 + modelRaw.length : 0) +
		(hammerRaw ? 2 + hammerRaw.length : 0) +
		(timeRaw ? 2 + timeRaw.length : 0);

	const detailTrunc = truncateDetail(stepDetail(r), width - fixedLen - 2);
	const detail = detailTrunc ? `  ${theme.fg("muted", detailTrunc)}` : "";

	return [
		truncateToWidth(
			`${pad}${dot} ${name}${model}${hammer}${time}${detail}`,
			width,
		),
	];
}

// ── Pending step enumeration from spec ────────────────────────────────────

interface PendingEntry {
	/** Label shown in the UI (may include pool index suffix like " [1]") */
	displayLabel: string;
	/** The original step label used by the executor (for matching against results) */
	matchLabel: string;
	group?: string;
	toolCount: number;
	model?: string;
}

function getSpecLabel(r: Runnable): string {
	switch (r.kind) {
		case "step":
			return r.label;
		case "sequential":
			return r.steps[0] ? getSpecLabel(r.steps[0]) : "seq";
		case "pool":
			return getSpecLabel(r.step);
		case "parallel":
			return "parallel";
		default:
			return "unknown";
	}
}

/** Recursively enumerate all atomic steps from a spec, with group labels. */
function flattenSpec(runnable: Runnable, group?: string): PendingEntry[] {
	switch (runnable.kind) {
		case "step":
			return [
				{
					displayLabel: runnable.label,
					matchLabel: runnable.label,
					group,
					toolCount: (runnable.tools ?? ["read", "bash", "edit", "write"])
						.length,
					model: runnable.model,
				},
			];
		case "sequential":
			return runnable.steps.flatMap((s) => flattenSpec(s, group));
		case "pool": {
			const poolGroup = `pool ×${runnable.count}: ${getSpecLabel(runnable.step)}`;
			return Array.from({ length: runnable.count }, (_, i) =>
				flattenSpec(runnable.step, poolGroup).map((s) => {
					// Both displayLabel and matchLabel use the index suffix — the executor
					// now tags each pool instance with [i+1] so labels are unique.
					const label =
						runnable.count > 1 ? `${s.matchLabel} [${i + 1}]` : s.matchLabel;
					return { ...s, displayLabel: label, matchLabel: label };
				}),
			).flat();
		}
		case "parallel": {
			const parGroup = `parallel ×${runnable.steps.length}`;
			return runnable.steps.flatMap((s) => flattenSpec(s, parGroup));
		}
		default:
			return [];
	}
}

/**
 * Build a map from step label → spec metadata (group, toolCount, model) for quick
 * lookup when rendering running steps that don't have a StepResult yet.
 */
function buildLabelSpecMap(
	spec: Runnable,
): Map<string, { group?: string; toolCount: number; model?: string }> {
	const entries = flattenSpec(spec);
	const map = new Map<
		string,
		{ group?: string; toolCount: number; model?: string }
	>();
	for (const e of entries)
		map.set(e.matchLabel, {
			group: e.group,
			toolCount: e.toolCount,
			model: e.model,
		});
	return map;
}

/**
 * Compute which spec steps are still pending (not yet in results or currentSteps).
 * Uses matchLabel (the original executor label) for counting, not displayLabel.
 */
function computePendingSteps(
	spec: Runnable,
	results: StepResult[],
	currentSteps: Set<string>,
): PendingEntry[] {
	const allExpected = flattenSpec(spec);

	// Count how many times each matchLabel is already accounted for
	const seen = new Map<string, number>();
	for (const r of results) seen.set(r.label, (seen.get(r.label) ?? 0) + 1);
	for (const label of currentSteps) seen.set(label, (seen.get(label) ?? 0) + 1);

	// Walk expected in order and skip already-accounted entries by matchLabel
	const pending: PendingEntry[] = [];
	const consumed = new Map<string, number>();
	for (const entry of allExpected) {
		const alreadySeen = seen.get(entry.matchLabel) ?? 0;
		const alreadyConsumed = consumed.get(entry.matchLabel) ?? 0;
		if (alreadyConsumed < alreadySeen) {
			consumed.set(entry.matchLabel, alreadyConsumed + 1);
		} else {
			pending.push(entry);
		}
	}
	return pending;
}

/** Append one step's lines to output, emit a group header if needed. Returns current group. */
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
		for (const row of renderStepLines(r, width - 3, 1, theme)) {
			lines.push(`${theme.fg("dim", "  │")}${row}`);
		}
	} else {
		lines.push(...renderStepLines(r, width, 2, theme));
	}
	return currentGroup;
}

/** Append a pending step's lines (from spec, not yet started). */
function appendPendingLine(
	lines: string[],
	entry: PendingEntry,
	lastGroup: string | undefined,
	width: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string | undefined {
	let currentGroup = lastGroup;
	if (entry.group && entry.group !== lastGroup) {
		lines.push(theme.fg("dim", `  ┬ ${entry.group}`));
		currentGroup = entry.group;
	} else if (!entry.group) {
		currentGroup = undefined;
	}
	const pendingResult: StepResult = {
		label: entry.displayLabel,
		status: "pending",
		output: "",
		elapsed: 0,
		group: entry.group,
		toolCount: entry.toolCount,
		model: entry.model,
	};
	if (entry.group) {
		for (const row of renderStepLines(pendingResult, width - 3, 1, theme)) {
			lines.push(`${theme.fg("dim", "  │")}${row}`);
		}
	} else {
		lines.push(...renderStepLines(pendingResult, width, 2, theme));
	}
	return currentGroup;
}

/** Render all steps as compact lines, grouping parallel/pool under a header */
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
	// Build a label→spec map so running steps can show model/toolCount before they complete
	const labelSpecMap = buildLabelSpecMap(spec);

	const runningSteps: StepResult[] = [...currentSteps].map((label) => {
		const stream = currentStepStreams.get(label) ?? "";
		const streamTail =
			stream
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? "";
		// Prefer live result data; fall back to spec metadata for steps not yet in results
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

/** Clear the pipeline widget after a short delay so the final state is readable. */
export function clearWidget(ctx: ExtensionContext) {
	setTimeout(() => ctx.ui.setWidget("captain", undefined), 5000);
}
