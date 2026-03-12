// ── ui/widget-render.ts — Step-level pure rendering helpers ──────────────────

import { truncateToWidth } from "@mariozechner/pi-tui";
import type { StepResult } from "../types.js";

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
export function renderStepLines(
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
