// ── tools/kill.ts — captain_kill tool registration ───────────────────────
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import { text } from "./helpers.js";

export function registerKillTool(pi: ExtensionAPI, state: CaptainState): void {
	pi.registerTool({
		name: "captain_kill",
		label: "Captain Kill",
		description:
			"Kill a running captain pipeline job by its numeric ID. Use captain_status to see running job IDs.",
		parameters: Type.Object({
			id: Type.Number({
				description:
					"Job ID to kill (returned by captain_run background, or listed in captain_status)",
			}),
		}),

		async execute(_toolId, params, _signal, _onUpdate, _ctx) {
			const outcome = state.killJob(params.id);
			const msg =
				outcome === "killed"
					? `Job #${params.id} killed.`
					: outcome === "not-running"
						? `Job #${params.id} is not running (status: ${state.jobs.get(params.id)?.state.status ?? "unknown"}).`
						: `No job #${params.id} found. Use captain_status to list jobs.`;
			return { content: [text(msg)], details: undefined };
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_kill ")) +
					theme.fg("error", `#${args.id}`),
				0,
				0,
			),

		renderResult: (result, _opts, theme) => {
			const content =
				result.content[0] && "text" in result.content[0]
					? result.content[0].text
					: "";
			const ok = content.startsWith("Job") && content.endsWith("killed.");
			return new Text(
				ok
					? theme.fg("success", `✓ ${content}`)
					: theme.fg("error", `✗ ${content}`),
				0,
				0,
			);
		},
	});
}
