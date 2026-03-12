// ── ui/widget-pending.ts — Pending step computation helpers ─────────────────

import type { Runnable, StepResult } from "../types.js";
import { renderStepLines } from "./widget-render.js";

export interface PendingEntry {
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
export function flattenSpec(
	runnable: Runnable,
	group?: string,
): PendingEntry[] {
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
export function buildLabelSpecMap(
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
export function computePendingSteps(
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
export function appendStepLine(
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
export function appendPendingLine(
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
