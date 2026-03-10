import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { Runnable } from "../types.js";
import { describeRunnable } from "../utils/index.js";

export function registerDefineTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_define",
		label: "Captain Define",
		description: [
			"Define a pipeline from a JSON spec (the Runnable tree).",
			"Runnable types: step, sequential, pool, parallel — infinitely nestable.",
			"",
			"Step shape: { kind: 'step', label, prompt, gate, onFail, transform, ...config }",
			"  - prompt supports $INPUT (previous output) and $ORIGINAL (user request)",
			"  - model?: 'sonnet'|'flash'|...  tools?: ['read','bash',...]  temperature?: 0.2",
			"  - systemPrompt?: '...'",
			"  - skills?: ['path/to/skill.md']  extensions?: ['path/to/ext.ts']",
			"  - jsonOutput?: true  → passes --mode json to pi (step output is structured JSON)",
			"  - gate: { type: 'command'|'user'|'file'|'assert'|'llm'|'none', value }",
			"  - llm gate: { type: 'llm', prompt: 'evaluation criteria', model?: 'flash', threshold?: 0.7 }",
			"  - onFail: retry | retryWithDelay(N, ms) | skip | warn | fallback(step) | ({ retryCount }) => ...",
			"  - transform: full | extract('key') | summarize() | ({ output, original, ctx }) => string",
			"",
			"Sequential: { kind: 'sequential', steps: Runnable[], gate?, onFail? }",
			"Pool: { kind: 'pool', step: Runnable, count: N, merge: { strategy }, gate?, onFail? }",
			"Parallel: { kind: 'parallel', steps: Runnable[], merge: { strategy }, gate?, onFail? }",
			"MergeStrategy: 'concat'|'awaitAll'|'firstPass'|'vote'|'rank'",
			"",
		].join("\n"),
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name" }),
			spec: Type.String({ description: "JSON string of the Runnable tree" }),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				const spec = JSON.parse(params.spec) as Runnable;

				if (!spec.kind) {
					return {
						content: [
							{
								type: "text",
								text: "Error: spec must have a 'kind' field (step, sequential, pool, parallel)",
							},
						],
						details: undefined,
					};
				}

				state.pipelines[params.name] = { spec };
				const summary = describeRunnable(spec, 0);

				return {
					content: [
						{
							type: "text",
							text: `Captain pipeline "${params.name}" defined:\n${summary}`,
						},
					],
					details: undefined,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing pipeline spec: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: undefined,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_define ")) +
					theme.fg("accent", args.name),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			if (result.content[0] && (result.content[0] as any).text?.startsWith("Error"))
				return new Text(theme.fg("error", "✗ Invalid spec"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline defined"), 0, 0);
		},
	});
}
