// ── ui/commands-register-b.ts — /captain-generate /captain-step /captain-help
// Extracted from commands.ts (Basic_knowledge.md ≤200 lines rule).
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PipelineState } from "../core/types.js";
import type { CaptainState } from "../state.js";
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
			const job = state.allocateJob(pipelineState);
			updateWidget(ctx, pipelineState);
			// Fire-and-forget: return immediately so the user can keep chatting.
			// The widget shows live progress; ctx.ui.notify fires on completion/error.
			void runRunnableFromCommand(
				pi,
				stepSpec,
				prompt,
				pipelineState,
				job,
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
					"  /captain                          Interactive launcher (pick + run)",
					"  /captain <name>                   Show structure of a pipeline",
					"  /captain <name|path> <input>      Load (if needed) and run directly",
					"",
					"  Quotes optional, both styles work:",
					"    /captain my-preset do the thing",
					"    /captain './pipe.ts' 'do the thing'",
					"",
					"── Ad-hoc Step ───────────────────────────────────────────────",
					"  /captain-step <prompt>                    Run with default tools",
					"  /captain-step <prompt> --model <id>       Override model",
					"  /captain-step <prompt> --tools <t1,t2>    Override tools",
					"  /captain-step <prompt> --label <text>     Set display label",
					"",
					"── Generation ────────────────────────────────────────────────",
					"  /captain-generate <goal>     Generate a pipeline with LLM",
				].join("\n"),
				"info",
			);
		},
	});
}
