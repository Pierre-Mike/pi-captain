import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
			"Generate a TypeScript pipeline file on-the-fly using LLM.",
			"The generated .ts file is saved to .pi/pipelines/<name>.ts,",
			"immediately registered, and ready to run — fully type-safe.",
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
						"If true, show the generated TypeScript without saving or registering it",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `🧠 Generating pipeline for: "${params.goal}"...`,
					},
				],
				details: undefined,
			});

			try {
				if (!ctx.model) {
					return {
						content: [{ type: "text", text: "Error: no model available" }],
						details: undefined,
					};
				}

				const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
				if (!apiKey) {
					return {
						content: [
							{
								type: "text",
								text: "Error: no API key available for the current model",
							},
						],
						details: undefined,
					};
				}

				const generated = await generatePipeline(
					params.goal,
					ctx.model,
					apiKey,
					signal ?? undefined,
				);

				if (params.dryRun) {
					return {
						content: [
							{
								type: "text",
								text: [
									`🔍 Dry Run — Generated pipeline "${generated.name}"`,
									`Description: ${generated.description}`,
									"",
									"── TypeScript Source ──",
									generated.tsSource,
									"",
									`To save & register: call captain_generate with the same goal and dryRun=false`,
								].join("\n"),
							},
						],
						details: undefined,
					};
				}

				// Save to .pi/pipelines/<name>.ts
				const piDir = join(ctx.cwd, ".pi", "pipelines");
				if (!existsSync(piDir)) mkdirSync(piDir, { recursive: true });
				state.ensureCaptainContractFile(ctx.cwd);
				const filePath = join(piDir, `${generated.name}.ts`);
				writeFileSync(filePath, generated.tsSource, "utf-8");

				// Load via the TS pipeline mechanism (no JSON deserialization needed)
				const loaded = await state.loadTsPipelineFile(filePath);
				const summary = describeRunnable(loaded.spec, 0);

				return {
					content: [
						{
							type: "text",
							text: [
								`✓ Generated and registered pipeline "${loaded.name}"`,
								`Description: ${generated.description}`,
								`Saved to: .pi/pipelines/${generated.name}.ts`,
								"",
								"── Structure ──",
								summary,
								"",
								`Run it with: captain_run({ name: "${loaded.name}", input: "<your input>" })`,
							].join("\n"),
						},
					],
					details: undefined,
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Pipeline generation failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: undefined,
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
			if (
				result.content[0] &&
				"text" in result.content[0] &&
				result.content[0].text.startsWith("Error")
			)
				return new Text(theme.fg("error", "✗ Generation failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline generated"), 0, 0);
		},
	});
}
