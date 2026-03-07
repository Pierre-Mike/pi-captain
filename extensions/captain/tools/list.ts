import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { CaptainDetails } from "../types.js";

export function registerListTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_list",
		label: "Captain List",
		description: "List all defined pipelines with their structure summary.",
		parameters: Type.Object({}),

		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.cwd ?? process.cwd();
			const lines = state.buildPipelineListLines(cwd);

			if (lines.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No pipelines defined or available. Use captain_define to create one.",
						},
					],
					details: state.snapshot(),
				};
			}

			const loaded = Object.keys(state.pipelines).length;
			const header = loaded > 0 ? `${loaded} pipeline(s) loaded:\n\n` : "";
			return {
				content: [{ type: "text", text: `${header}${lines.join("\n")}` }],
				details: state.snapshot(),
			};
		},

		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("captain_list")), 0, 0),
		renderResult: (result, _opts, theme) => {
			const d = result.details as CaptainDetails | undefined;
			const count = d ? Object.keys(d.pipelines).length : 0;
			return new Text(theme.fg("success", `${count} pipeline(s)`), 0, 0);
		},
	});
}
