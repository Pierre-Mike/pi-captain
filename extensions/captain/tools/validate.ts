// ── tools/validate.ts — captain_validate tool registration ───────────────
// Pure validation logic lives in core/validate.ts.
// This file only handles tool registration and result formatting.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { validateRunnable } from "../core/validate.js";
import type { CaptainState } from "../state.js";
import type { Runnable } from "../types.js";

export function registerValidateTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_validate",
		label: "Captain Validate",
		description: [
			"Validate a pipeline specification for structural correctness.",
			"Checks required fields, gate/onFail consistency, and merge presence for parallel/pool.",
			"Accepts either a pipeline name (already loaded) or a raw JSON spec string.",
		].join("\n"),
		parameters: Type.Union([
			Type.Object({
				name: Type.String({
					description: "Name of an already-loaded pipeline to validate",
				}),
			}),
			Type.Object({
				spec: Type.String({
					description: "Raw JSON string of the Runnable tree to validate",
				}),
			}),
		]),

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			let runnable: Runnable;
			let sourceName: string;

			try {
				if ("name" in params) {
					const pipeline = state.pipelines[params.name];
					if (!pipeline) {
						return {
							content: [
								{
									type: "text",
									text: `✗ Pipeline "${params.name}" not found. Use captain_list to see available pipelines.`,
								},
							],
							details: undefined,
						};
					}
					runnable = pipeline.spec;
					sourceName = params.name;
				} else {
					runnable = JSON.parse(params.spec) as Runnable;
					sourceName = "spec";
				}
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `✗ Error parsing pipeline spec: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: undefined,
				};
			}

			const result = validateRunnable(runnable);

			if (result.valid) {
				return {
					content: [
						{
							type: "text",
							text: `✓ Pipeline "${sourceName}" is structurally valid.`,
						},
					],
					details: undefined,
				};
			}

			const errorList = result.errors.map((e) => `  • ${e}`).join("\n");
			return {
				content: [
					{
						type: "text",
						text: `✗ Pipeline "${sourceName}" has validation errors:\n\n${errorList}`,
					},
				],
				details: undefined,
			};
		},

		renderCall: (args, theme) => {
			const target = "name" in args ? `name=${args.name}` : "spec";
			return new Text(
				theme.fg("toolTitle", theme.bold("captain_validate ")) +
					theme.fg("accent", target),
				0,
				0,
			);
		},
		renderResult: (result, _opts, theme) => {
			if (
				result.content[0] &&
				"text" in result.content[0] &&
				result.content[0].text.startsWith("✓")
			)
				return new Text(theme.fg("success", "✓ Valid"), 0, 0);
			return new Text(theme.fg("error", "✗ Invalid"), 0, 0);
		},
	});
}
