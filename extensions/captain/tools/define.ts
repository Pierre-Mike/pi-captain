import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { CaptainDetails, Runnable } from "../types.js";
import { collectAgentRefs, describeRunnable } from "../utils/index.js";

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
			"  - agent?: named agent (optional — inline fields below override agent defaults)",
			"  - model?: 'sonnet'|'flash'|...  tools?: ['read','bash',...]  systemPrompt?: '...'",
			"  - skills?: ['path/to/skill.md']  extensions?: ['path/to/ext.ts']",
			"  - jsonOutput?: true  → passes --mode json to pi (step output is structured JSON)",
			"  - gate: { type: 'command'|'user'|'file'|'assert'|'llm'|'none', value }",
			"  - llm gate: { type: 'llm', prompt: 'evaluation criteria', model?: 'flash', threshold?: 0.7 }",
			"  - onFail: { action: 'retry'|'skip'|'fallback', max?, step? }",
			"  - transform: { kind: 'full'|'extract'|'summarize', key? }",
			"",
			"Sequential: { kind: 'sequential', steps: Runnable[], gate?, onFail? }",
			"Pool: { kind: 'pool', step: Runnable, count: N, merge: { strategy }, gate?, onFail? }",
			"Parallel: { kind: 'parallel', steps: Runnable[], merge: { strategy }, gate?, onFail? }",
			"MergeStrategy: 'concat'|'awaitAll'|'firstPass'|'vote'|'rank'",
			"",
			"Define agents first with captain_agent, then reference them by name.",
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
						isError: true,
					};
				}

				const unknownAgents = collectAgentRefs(spec).filter(
					(name) => !state.agents[name],
				);
				const warning =
					unknownAgents.length > 0
						? `\n⚠️  Unknown agent(s): ${unknownAgents.join(", ")} — make sure they are defined before running.`
						: "";

				state.pipelines[params.name] = { spec };
				const savedPath = state.savePipelineToFile(params.name, spec, ctx.cwd);
				const summary = describeRunnable(spec, 0);

				return {
					content: [
						{
							type: "text",
							text: `Captain pipeline "${params.name}" defined:${warning}\n${summary}\n\n💾 Saved to ${savedPath}`,
						},
					],
					details: state.snapshot(),
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing pipeline spec: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
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
			if (result.isError)
				return new Text(theme.fg("error", "✗ Invalid spec"), 0, 0);
			const d = result.details as CaptainDetails | undefined;
			const count = d ? Object.keys(d.pipelines).length : 0;
			return new Text(
				theme.fg("success", `✓ ${count} pipeline(s) defined`),
				0,
				0,
			);
		},
	});
}
