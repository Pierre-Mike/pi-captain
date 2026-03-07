// ── Captain Pipeline Progress Widget ─────────────────────────────────────

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import type { PipelineState } from "../types.js";

/** Map step status to theme color name */
export function statusColor(status: string): string {
	if (status === "passed") return "success";
	if (status === "failed") return "error";
	if (status === "running") return "accent";
	return "dim";
}

/** Map step status to a single visual icon (agent-team style) */
export function statusDot(status: string): string {
	if (status === "passed") return "✓";
	if (status === "failed") return "✗";
	if (status === "skipped") return "⊘";
	if (status === "running") return "●";
	return "○";
}

/** Render a single step as a bordered card */
export function renderStepCard(
	label: string,
	status: string,
	elapsed: number,
	detail: string,
	colWidth: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string[] {
	const w = colWidth - 2;
	const truncate = (s: string, max: number) =>
		s.length > max ? `${s.slice(0, max - 3)}...` : s;

	const color = statusColor(status);
	const dot = statusDot(status);
	const timeStr = elapsed > 0 ? ` ${elapsed.toFixed(1)}s` : "";

	const nameRaw = truncate(label, w - 1);
	const nameStr = theme.fg("accent", theme.bold(nameRaw));

	const statusRaw = `${dot} ${status}${timeStr}`;
	const statusStr = theme.fg(color, statusRaw);

	const detailRaw = truncate(detail, w - 1);
	const detailStr = theme.fg("muted", detailRaw);

	const top = `┌${"─".repeat(w)}┐`;
	const bot = `└${"─".repeat(w)}┘`;
	const border = (content: string, visLen: number) =>
		theme.fg("dim", "│") +
		content +
		" ".repeat(Math.max(0, w - visLen)) +
		theme.fg("dim", "│");

	return [
		theme.fg("dim", top),
		border(` ${nameStr}`, 1 + nameRaw.length),
		border(` ${statusStr}`, 1 + statusRaw.length),
		border(` ${detailStr}`, 1 + detailRaw.length),
		theme.fg("dim", bot),
	];
}

/** Render a grid of step cards into lines */
export function renderStepGrid(
	results: PipelineState["results"],
	currentStep: string | undefined,
	currentStepStream: string | undefined,
	width: number,
	// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
	theme: any,
): string[] {
	const streamDetail = currentStepStream
		? (currentStepStream
				.split("\n")
				.filter((l) => l.trim())
				.at(-1) ?? "")
		: "";
	const all: PipelineState["results"] = currentStep
		? [
				...results,
				{
					label: currentStep,
					status: "running",
					output: streamDetail,
					elapsed: 0,
				},
			]
		: results;

	if (all.length === 0) return [theme.fg("dim", "  Waiting for steps...")];

	const cols = Math.min(2, all.length);
	const gap = 1;
	const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
	const lines: string[] = [];

	for (let i = 0; i < all.length; i += cols) {
		const rowSteps = all.slice(i, i + cols);
		const cards = rowSteps.map((r) =>
			renderStepCard(
				r.label,
				r.status,
				r.elapsed / 1000,
				r.error ?? r.output?.slice(0, 80) ?? "",
				colWidth,
				theme,
			),
		);
		while (cards.length < cols)
			cards.push(new Array(5).fill(" ".repeat(colWidth)));
		const cardHeight = cards[0].length;
		for (let line = 0; line < cardHeight; line++) {
			lines.push(cards.map((c) => c[line] ?? "").join(" ".repeat(gap)));
		}
	}

	return lines;
}

/** Update the live widget showing pipeline progress (grid of step cards) */
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
					...renderStepGrid(
						state.results,
						state.currentStep,
						state.currentStepStream,
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
