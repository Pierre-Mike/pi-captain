import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";

export function registerListTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_list",
		label: "Captain List",
		description: "List all defined pipelines with their structure summary.",
		parameters: Type.Object({}),

		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const _cwd = ctx?.cwd ?? process.cwd();
			const lines = state.buildPipelineListLines();

			if (lines.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No pipelines defined or available. Use captain_define to create one.",
						},
					],
					details: undefined,
				};
			}

			const loaded = Object.keys(state.pipelines).length;
			const header = loaded > 0 ? `${loaded} pipeline(s) loaded:\n\n` : "";
			return {
				content: [{ type: "text", text: `${header}${lines.join("\n")}` }],
				details: undefined,
			};
		},

		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("captain_list")), 0, 0),
		renderResult: (_result, _opts, theme) =>
			new Text(theme.fg("success", "✓ Listed"), 0, 0),
	});
}
