// ── ui/commands-register-b.ts — /captain-generate /captain-step /captain-help
// Extracted from commands.ts (Basic_knowledge.md ≤200 lines rule).
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CaptainState } from "../state.js";
import type { PipelineState } from "../types.js";
import { runRunnableFromCommand } from "./commands-exec.js";
import { buildAdHocStep, parseInlineFlags } from "./commands-parse.js";
import { updateWidget } from "./widget.js";

export function registerCommandsB(pi: ExtensionAPI, state: CaptainState): void {
	// /captain-generate — delegate to LLM
	pi.registerCommand("captain-generate", {
		description:
			"Generate a pipeline on-the-fly with LLM (/captain-generate <goal>)",
		handler: async (args, _ctx) => {
			const goal = args?.trim();
			if (!goal) {
				_ctx.ui.notify(
					"Usage: /captain-generate <what you want the pipeline to do>",
					"error",
				);
				return;
			}
			pi.sendUserMessage(
				`Generate a captain pipeline for this goal: ${goal}\nUse captain_generate tool with goal="${goal}".`,
			);
		},
	});

	// /captain-step — run a single ad-hoc step
	pi.registerCommand("captain-step", {
		description:
			"Run a single ad-hoc step inline: /captain-step <prompt> [--model <id>] [--tools <t1,t2>] [--label <label>]",
		getArgumentCompletions: (prefix) => {
			const flags = ["--model ", "--tools ", "--label "];
			return flags
				.filter((f) => f.startsWith(prefix))
				.map((f) => ({ value: f, label: f.trim() }));
		},
		handler: async (args, ctx) => {
			const raw = args?.trim() ?? "";
			if (!raw) {
				ctx.ui.notify(
					[
						"Usage: /captain-step <prompt> [options]",
						"",
						"Options:",
						"  --model <id>       Model to use (default: current model)",
						"  --tools <t1,t2>    Comma-separated tools (default: read,bash,edit,write)",
						"  --label <text>     Step label shown in UI (default: 'ad-hoc step')",
					].join("\n"),
					"info",
				);
				return;
			}
			const { flags, prompt } = parseInlineFlags(raw);
			if (!prompt) {
				ctx.ui.notify("Provide a prompt after the flags.", "error");
				return;
			}
			const stepSpec = buildAdHocStep(prompt, flags);
			const pipelineState: PipelineState = {
				name: `step:${stepSpec.label}`,
				spec: stepSpec,
				status: "running",
				results: [],
				currentSteps: new Set(),
				currentStepStreams: new Map(),
				currentStepToolCalls: new Map(),
				startTime: Date.now(),
			};
			state.runningState = pipelineState;
			updateWidget(ctx, pipelineState);
			await runRunnableFromCommand(
				pi,
				stepSpec,
				prompt,
				pipelineState,
				state,
				ctx,
			);
		},
	});

	// /captain-help — show all commands
	pi.registerCommand("captain-help", {
		description: "Show all captain commands and usage",
		handler: async (_args, ctx) => {
			const pipelineCount = Object.keys(state.pipelines).length;
			ctx.ui.notify(
				[
					`Captain — Pipeline Orchestrator  (${pipelineCount} pipeline(s))`,
					"",
					"── Pipeline Commands ─────────────────────────────────────────",
					"  /captain                     List all loaded pipelines",
					"  /captain <name>              Show structure of a pipeline",
					"  /captain-load                List available presets",
					"  /captain-load <name>         Load a preset pipeline",
					"  /captain-run <name> <input>  Run a full pipeline directly",
					"  /captain-run <name> --step <label> <input>",
					"                               Run a single step from a pipeline",
					"",
					"── Ad-hoc Step ───────────────────────────────────────────────",
					"  /captain-step <prompt>                    Run with default tools",
					"  /captain-step <prompt> --model <id>       Override model",
					"  /captain-step <prompt> --tools <t1,t2>    Override tools",
					"  /captain-step <prompt> --label <text>     Set display label",
					"",
					"── Generation ────────────────────────────────────────────────",
					"  /captain-generate <goal>     Generate a pipeline with LLM",
					"",
					"── Tips ──────────────────────────────────────────────────────",
					"  • /captain-run auto-loads presets — no need to /captain-load first",
					"  • Use --step to debug or replay a single step from any pipeline",
					"  • Tab-complete pipeline names after /captain-run and /captain-load",
				].join("\n"),
				"info",
			);
		},
	});
}
