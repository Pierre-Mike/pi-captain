import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import { statusIcon } from "../utils/index.js";

export function registerStatusTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_status",
		label: "Captain Status",
		description:
			"Check status of a running or completed captain pipeline. Shows step-by-step results, gates, and errors.",
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name" }),
		}),

		async execute(_id, params) {
			if (!state.runningState || state.runningState.name !== params.name) {
				const pipeline = state.pipelines[params.name];
				if (!pipeline) {
					return {
						content: [
							{ type: "text", text: `Pipeline "${params.name}" not found.` },
						],
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `Pipeline "${params.name}" defined but has not been run yet.`,
						},
					],
				};
			}

			const s = state.runningState;
			const lines = [
				`Pipeline: ${s.name} — Status: ${s.status}`,
				s.startTime ? `Started: ${new Date(s.startTime).toISOString()}` : "",
				s.endTime ? `Ended: ${new Date(s.endTime).toISOString()}` : "",
				"",
				"── Steps ──",
				...s.results.map(
					(r) =>
						`${statusIcon(r.status)} ${r.label}: ${r.status} (${(r.elapsed / 1000).toFixed(1)}s)${r.gateResult ? ` [gate: ${r.gateResult.passed ? "pass" : "fail"}]` : ""}${r.error ? ` — ${r.error}` : ""}`,
				),
			].filter(Boolean);

			if (s.finalOutput) {
				lines.push("", "── Final Output ──", s.finalOutput.slice(0, 2000));
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
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
