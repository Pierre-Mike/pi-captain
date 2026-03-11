import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { PipelineState, StepResult } from "../types.js";
import { statusIcon } from "../utils/index.js";

// ── Formatting helpers ─────────────────────────────────────────────────────

function stepLine(r: StepResult): string {
	const gate = r.gateResult
		? ` [gate: ${r.gateResult.passed ? "pass" : "fail"}]`
		: "";
	const err = r.error ? ` — ${r.error}` : "";
	return `${statusIcon(r.status)} ${r.label}: ${r.status} (${(r.elapsed / 1000).toFixed(1)}s)${gate}${err}`;
}

function buildStatusLines(s: PipelineState): string[] {
	const elapsed =
		s.endTime && s.startTime
			? ` (${((s.endTime - s.startTime) / 1000).toFixed(1)}s total)`
			: "";

	const lines = [
		`Pipeline: ${s.name} — Status: ${s.status}`,
		s.startTime ? `Started: ${new Date(s.startTime).toISOString()}` : "",
		s.endTime ? `Ended: ${new Date(s.endTime).toISOString()}${elapsed}` : "",
		"",
		"── Steps ──",
		...s.results.map(stepLine),
	].filter(Boolean);

	if (s.finalOutput) {
		lines.push("", "── Final Output ──", s.finalOutput.slice(0, 2000));
	}
	return lines;
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerStatusTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_status",
		label: "Captain Status",
		description:
			"Check status of a running or completed captain pipeline. Shows step-by-step results, gates, and errors.",
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name" }),
		}),

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			if (!state.runningState || state.runningState.name !== params.name) {
				const pipeline = state.pipelines[params.name];
				if (!pipeline) {
					return {
						content: [
							{ type: "text", text: `Pipeline "${params.name}" not found.` },
						],
						details: undefined,
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `Pipeline "${params.name}" defined but has not been run yet.`,
						},
					],
					details: undefined,
				};
			}

			const lines = buildStatusLines(state.runningState);
			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: undefined,
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_status ")) +
					theme.fg("muted", args.name),
				0,
				0,
			),
	});
}
