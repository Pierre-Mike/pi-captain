import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import { describeRunnable } from "../utils/index.js";

// ── Helpers extracted to keep execute() complexity low ────────────────────

function listPresets(state: CaptainState, _cwd: string) {
	const presets = state.discoverPresets();
	if (presets.length === 0) {
		return {
			content: [
				{
					type: "text" as const,
					text: "No presets found. Add .ts modules to pipelines/ or .json files to .pi/pipelines/",
				},
			],
			details: undefined,
		};
	}
	return {
		content: [
			{
				type: "text" as const,
				text: `Available pipeline presets:\n${presets.map((p) => `  • ${p.name} (${p.source})`).join("\n")}`,
			},
		],
		details: undefined,
	};
}

function missingNameError() {
	return {
		content: [
			{
				type: "text" as const,
				text: "Error: 'name' is required for load action. Use action 'list' to see available presets.",
			},
		],
		details: undefined,
	};
}

async function loadPreset(state: CaptainState, name: string, cwd: string) {
	try {
		const resolved = await state.resolvePreset(name, cwd);
		if (!resolved) {
			return {
				content: [
					{
						type: "text" as const,
						text: `Error: preset or file "${name}" not found.\nUse action 'list' to see available presets, or provide a valid file path.`,
					},
				],
				details: undefined,
			};
		}
		const summary = describeRunnable(resolved.spec, 0);
		return {
			content: [
				{
					type: "text" as const,
					text: `Loaded pipeline "${resolved.name}"${resolved.source ? ` from ${resolved.source}` : ""}\n\n${summary}`,
				},
			],
			details: undefined,
		};
	} catch (err) {
		return {
			content: [
				{
					type: "text" as const,
					text: `Error loading pipeline: ${err instanceof Error ? err.message : String(err)}`,
				},
			],
			details: undefined,
		};
	}
}

// ── Tool Registration ─────────────────────────────────────────────────────

export function registerLoadTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_load",
		label: "Captain Load",
		description: [
			"Load a precreated pipeline from a JSON file. Accepts either:",
			"  - A preset name (e.g. 'research-and-summarize') from builtin samples or .pi/pipelines/",
			"  - An absolute or relative file path to a pipeline JSON file",
			"",
			"Pipeline JSON format: { agents: { ... }, pipeline: { kind, ... } }",
			"Use action 'list' to see all available presets.",
		].join("\n"),
		parameters: Type.Object({
			action: Type.Union([Type.Literal("load"), Type.Literal("list")]),
			name: Type.Optional(
				Type.String({
					description: "Preset name or file path (required for 'load')",
				}),
			),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (params.action === "list") return listPresets(state, ctx.cwd);
			if (!params.name) return missingNameError();
			return await loadPreset(state, params.name, ctx.cwd);
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_load ")) +
					theme.fg(
						"accent",
						args.action === "list" ? "list" : (args.name ?? ""),
					),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			if (result.content[0] && (result.content[0] as any).text?.startsWith("Error"))
				return new Text(theme.fg("error", "✗ Load failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline loaded"), 0, 0);
		},
	});
}
