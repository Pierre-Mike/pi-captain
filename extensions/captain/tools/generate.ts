import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { generatePipeline } from "../generator.js";
import type { CaptainState } from "../state.js";
import { describeRunnable } from "../utils/index.js";

export function registerGenerateTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_generate",
		label: "Captain Generate",
		description: [
			"Generate a pipeline on-the-fly using LLM. Inspects all available agents,",
			"gate types, and step patterns, then produces a complete pipeline spec.",
			"The generated pipeline is immediately registered and ready to run.",
			"",
			"Examples:",
			'  captain_generate({ goal: "review this PR for security and quality" })',
			'  captain_generate({ goal: "build a REST API with tests", dryRun: true })',
			'  captain_generate({ goal: "research and document best practices for auth" })',
		].join("\n"),
		parameters: Type.Object({
			goal: Type.String({
				description: "What you want the pipeline to accomplish",
			}),
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"If true, show the generated spec without registering it",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const agentCount = Object.keys(state.agents).length;
			if (agentCount === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No agents available. Define agents with captain_agent or add .md files to ~/.pi/agent/agents/",
						},
					],
					isError: true,
				};
			}

			onUpdate?.({
				content: [
					{
						type: "text",
						text: `🧠 Generating pipeline for: "${params.goal}" (${agentCount} agents available)...`,
					},
				],
			});

			try {
				const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
				if (!apiKey) {
					return {
						content: [
							{
								type: "text",
								text: "Error: no API key available for the current model",
							},
						],
						isError: true,
					};
				}

				const generated = await generatePipeline(
					params.goal,
					state.agents,
					ctx.model,
					apiKey,
					signal ?? undefined,
				);

				const specJson = JSON.stringify(generated.pipeline, null, 2);
				const summary = describeRunnable(generated.pipeline, 0);

				if (params.dryRun) {
					return {
						content: [
							{
								type: "text",
								text: [
									`🔍 Dry Run — Generated pipeline "${generated.name}"`,
									`Description: ${generated.description}`,
									"",
									"── Structure ──",
									summary,
									"",
									"── Full Spec (JSON) ──",
									specJson,
									"",
									`To register: call captain_generate with the same goal and dryRun=false`,
								].join("\n"),
							},
						],
						details: state.snapshot(),
					};
				}

				state.pipelines[generated.name] = { spec: generated.pipeline };
				const savedPath = state.savePipelineToFile(
					generated.name,
					generated.pipeline,
					ctx.cwd,
				);

				return {
					content: [
						{
							type: "text",
							text: [
								`✓ Generated and registered pipeline "${generated.name}"`,
								`Description: ${generated.description}`,
								"",
								"── Structure ──",
								summary,
								"",
								`💾 Saved to ${savedPath}`,
								`Run it with: captain_run({ name: "${generated.name}", input: "<your input>" })`,
							].join("\n"),
						},
					],
					details: state.snapshot(),
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Pipeline generation failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_generate ")) +
					theme.fg("dim", "— ") +
					theme.fg(
						"muted",
						`"${(args.goal as string).slice(0, 50)}${(args.goal as string).length > 50 ? "…" : ""}"`,
					),
				0,
				0,
			),
		renderResult: (result, { isPartial }, theme) => {
			if (isPartial)
				return new Text(theme.fg("accent", "● Generating pipeline..."), 0, 0);
			if (result.isError)
				return new Text(theme.fg("error", "✗ Generation failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline generated"), 0, 0);
		},
	});
}
