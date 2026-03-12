// loop.ts — General-purpose agent loop extension
// Supports 3 modes:
//   /loop goal <description>     — repeat until the LLM declares the goal met
//   /loop passes <N> <task>      — repeat exactly N times
//   /loop pipeline <s1|s2|s3>    — run stages sequentially, stop after last
//
// The LLM gets a `loop_control` tool to signal progress/completion.
// Ctrl+Shift+X to abort at any time.

import { StringEnum } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Key, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

type LoopMode = "goal" | "passes" | "pipeline";

interface LoopState {
	active: boolean;
	mode: LoopMode;
	currentStep: number;
	maxSteps: number; // Infinity for goal mode, N for passes, stages.length for pipeline
	goal: string; // User's description of what we're doing
	stages: string[]; // Pipeline stages (or single repeated task)
	done: boolean; // LLM signaled completion
	reasonDone: string; // Why the LLM stopped
}

function emptyState(): LoopState {
	return {
		active: false,
		mode: "goal",
		currentStep: 0,
		maxSteps: 0,
		goal: "",
		stages: [],
		done: false,
		reasonDone: "",
	};
}

export default function (pi: ExtensionAPI) {
	let state = emptyState();

	// ── Reconstruct state from session branch ────────────────────────────
	const reconstruct = (ctx: ExtensionContext) => {
		state = emptyState();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role === "toolResult" && msg.toolName === "loop_control") {
				const d = msg.details as LoopState | undefined;
				if (d) state = { ...d };
			}
		}
	};

	pi.on("session_start", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_fork", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_e, ctx) => reconstruct(ctx));

	// ── Widget: show loop progress in the panel above the editor ─────────
	function updateWidget(ctx: ExtensionContext) {
		if (!state.active) {
			ctx.ui.setStatus("loop", undefined);
			ctx.ui.setWidget("loop", undefined);
			return;
		}

		const label =
			state.mode === "pipeline"
				? `stage ${state.currentStep + 1}/${state.stages.length}: ${state.stages[state.currentStep] ?? "?"}`
				: state.mode === "passes"
					? `pass ${state.currentStep + 1}/${state.maxSteps}`
					: `iteration ${state.currentStep + 1} (until goal met)`;

		ctx.ui.setStatus("loop", `🔄 ${label}`);
		ctx.ui.setWidget("loop", [
			`┌─ Loop: ${state.mode} ──────────`,
			`│ ${state.goal}`,
			`│ ${label}`,
			`└─ Ctrl+Shift+X to stop ────────`,
		]);
	}

	// ── Build the steer message for the current iteration ────────────────
	function buildPrompt(): string {
		const step = state.currentStep;

		if (state.mode === "pipeline") {
			const stage = state.stages[step];
			const remaining = state.stages.length - step - 1;
			return [
				`## Loop — Pipeline stage ${step + 1}/${state.stages.length}`,
				`Overall goal: ${state.goal}`,
				`Current stage: **${stage}**`,
				remaining > 0
					? `Remaining stages: ${state.stages.slice(step + 1).join(" → ")}`
					: `This is the **final stage**. Call loop_control with status "done" when complete.`,
				`\nExecute this stage now. When finished, call loop_control with status "done" if this is the last stage, or "next" to advance.`,
			].join("\n");
		}

		if (state.mode === "passes") {
			return [
				`## Loop — Pass ${step + 1} of ${state.maxSteps}`,
				`Task: ${state.goal}`,
				step === 0
					? `This is the first pass. Do an initial implementation/analysis.`
					: step < state.maxSteps - 1
						? `This is a refinement pass. Review and improve on the previous pass.`
						: `This is the **final pass**. Do a final polish, then call loop_control with status "done".`,
				`\nWhen this pass is complete, call loop_control with status "next" (or "done" on the final pass).`,
			].join("\n");
		}

		// Goal mode — open-ended
		return [
			`## Loop — Iteration ${step + 1}`,
			`Goal: ${state.goal}`,
			`Work toward the goal. When the goal is fully met, call loop_control with status "done" and explain why.`,
			`If more work is needed, call loop_control with status "next" describing what's left.`,
		].join("\n");
	}

	// ── Core: auto-advance after each agent turn ────────────────────────
	pi.on("agent_end", async (_e, ctx) => {
		if (!state.active || state.done) return;

		// Safety: if LLM didn't call loop_control, nudge it
		// (This handles cases where the LLM forgets to call the tool)
		// We give one grace turn, then auto-advance
	});

	// ── Tool: the LLM calls this to signal progress ─────────────────────
	pi.registerTool({
		name: "loop_control",
		label: "Loop Control",
		description: [
			"Signal loop progress. Call this when you finish a loop iteration.",
			"status 'next': advance to the next step/pass/stage.",
			"status 'done': the goal is met or the final stage/pass is complete.",
			"Only available when a loop is active.",
		].join(" "),
		parameters: Type.Object({
			status: StringEnum(["next", "done"] as const),
			summary: Type.String({
				description: "Brief summary of what was accomplished this iteration",
			}),
			reason: Type.Optional(
				Type.String({ description: "Why the goal is met (for 'done')" }),
			),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [
						{ type: "text", text: "No active loop. Start one with /loop." },
					],
					isError: true,
				};
			}

			if (params.status === "done") {
				// LLM says we're done
				state.done = true;
				state.reasonDone = params.reason ?? params.summary;
				state.active = false;
				updateWidget(ctx);

				return {
					content: [
						{
							type: "text",
							text: `✓ Loop complete after ${state.currentStep + 1} iteration(s). Reason: ${state.reasonDone}`,
						},
					],
					details: { ...state } as LoopState,
				};
			}

			// status === "next" — advance
			state.currentStep++;

			// Check if we've hit the limit
			const atEnd =
				state.mode === "passes"
					? state.currentStep >= state.maxSteps
					: state.mode === "pipeline"
						? state.currentStep >= state.stages.length
						: false; // goal mode has no limit

			if (atEnd) {
				state.done = true;
				state.active = false;
				state.reasonDone = `Completed all ${state.mode === "passes" ? "passes" : "stages"}`;
				updateWidget(ctx);

				return {
					content: [
						{
							type: "text",
							text: `✓ Loop complete — all ${state.maxSteps} iterations done.`,
						},
					],
					details: { ...state } as LoopState,
				};
			}

			// Continue: inject the next iteration prompt
			updateWidget(ctx);

			// Schedule the next iteration as a steer message
			// (runs after this tool result is processed)
			setTimeout(() => {
				pi.sendMessage(
					{
						customType: "loop-iteration",
						content: buildPrompt(),
						display: false,
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
			}, 100);

			return {
				content: [
					{
						type: "text",
						text: `→ Advancing to step ${state.currentStep + 1}. Summary: ${params.summary}`,
					},
				],
				details: { ...state } as LoopState,
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("loop_control ")) +
					theme.fg(args.status === "done" ? "success" : "accent", args.status),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			const d = result.details as LoopState | undefined;
			if (!d) return new Text("", 0, 0);
			const icon = d.done ? "✓" : "→";
			const color = d.done ? "success" : "accent";
			return new Text(
				theme.fg(color, `${icon} step ${d.currentStep + 1} — ${d.mode}`),
				0,
				0,
			);
		},
	});

	// ── Inject loop context into the system prompt ───────────────────────
	pi.on("before_agent_start", async (event, _ctx) => {
		if (!state.active) return;
		return {
			systemPrompt:
				event.systemPrompt +
				[
					"",
					"",
					"## Active Loop",
					`Mode: ${state.mode} | Step: ${state.currentStep + 1}/${state.maxSteps === Infinity ? "∞" : state.maxSteps}`,
					`Goal: ${state.goal}`,
					"You MUST call `loop_control` when you finish your work for this iteration.",
					'Use status "next" to advance or "done" when the goal is fully met.',
				].join("\n"),
		};
	});

	// ── /loop command — start a loop ─────────────────────────────────────
	pi.registerCommand("loop", {
		description:
			"Start a loop. Usage: /loop goal <desc> | /loop passes <N> <task> | /loop pipeline <s1|s2|s3> <goal>",
		getArgumentCompletions: () => [
			{
				value: "goal ",
				label: "goal <description>",
				description: "Loop until goal is met",
			},
			{
				value: "passes ",
				label: "passes <N> <task>",
				description: "Run exactly N passes",
			},
			{
				value: "pipeline ",
				label: "pipeline <s1|s2|s3> <goal>",
				description: "Run stages in order",
			},
		],
		handler: async (args, ctx) => {
			if (!args?.trim()) {
				ctx.ui.notify(
					"Usage:\n  /loop goal <description>\n  /loop passes <N> <task>\n  /loop pipeline <s1|s2|s3> <goal>",
					"info",
				);
				return;
			}

			await ctx.waitForIdle();

			const parts = args.trim().split(/\s+/);
			const mode = parts[0] as LoopMode;

			if (mode === "goal") {
				const goal = parts.slice(1).join(" ");
				if (!goal) {
					ctx.ui.notify("Provide a goal description", "error");
					return;
				}
				state = {
					active: true,
					mode: "goal",
					currentStep: 0,
					maxSteps: Infinity,
					goal,
					stages: [],
					done: false,
					reasonDone: "",
				};
			} else if (mode === "passes") {
				const n = parseInt(parts[1], 10);
				if (!n || n < 1) {
					ctx.ui.notify("Provide a valid number of passes", "error");
					return;
				}
				const task = parts.slice(2).join(" ");
				if (!task) {
					ctx.ui.notify("Provide a task description", "error");
					return;
				}
				state = {
					active: true,
					mode: "passes",
					currentStep: 0,
					maxSteps: n,
					goal: task,
					stages: [],
					done: false,
					reasonDone: "",
				};
			} else if (mode === "pipeline") {
				// First arg after "pipeline" is pipe-separated stages, rest is the goal
				const stagesStr = parts[1];
				if (!stagesStr) {
					ctx.ui.notify("Provide stages separated by |", "error");
					return;
				}
				const stages = stagesStr
					.split("|")
					.map((s) => s.trim())
					.filter(Boolean);
				if (stages.length === 0) {
					ctx.ui.notify("Need at least one stage", "error");
					return;
				}
				const goal = parts.slice(2).join(" ") || stages.join(" → ");
				state = {
					active: true,
					mode: "pipeline",
					currentStep: 0,
					maxSteps: stages.length,
					goal,
					stages,
					done: false,
					reasonDone: "",
				};
			} else {
				ctx.ui.notify(
					`Unknown mode "${mode}". Use: goal, passes, or pipeline`,
					"error",
				);
				return;
			}

			updateWidget(ctx);
			// Kick off the first iteration
			pi.sendUserMessage(buildPrompt());
		},
	});

	// ── /loop-stop command ───────────────────────────────────────────────
	pi.registerCommand("loop-stop", {
		description: "Stop the active loop",
		handler: async (_args, ctx) => {
			if (!state.active) {
				ctx.ui.notify("No active loop", "info");
				return;
			}
			state.active = false;
			state.done = true;
			state.reasonDone = "Stopped by user";
			updateWidget(ctx);
			ctx.ui.notify(
				`Loop stopped after ${state.currentStep + 1} iteration(s)`,
				"warning",
			);
		},
	});

	// ── Ctrl+Shift+X — emergency stop ───────────────────────────────────
	pi.registerShortcut(Key.ctrlShift("x"), {
		description: "Stop the active loop",
		handler: async (ctx) => {
			if (!state.active) return;
			state.active = false;
			state.done = true;
			state.reasonDone = "Stopped by shortcut";
			updateWidget(ctx);
			ctx.abort(); // also abort the current LLM turn
			ctx.ui.notify("Loop aborted", "warning");
		},
	});
}
