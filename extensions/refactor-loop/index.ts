// Refactor Loop — iterative simplification pipeline extension
// Runs analyze → refactor → verify (tests!) cycles, then commits and pushes
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const baseDir = dirname(fileURLToPath(import.meta.url));

// ─── State types ───────────────────────────────────────────────────────────

interface RefactorPass {
	pass: number;
	change: string;
	reason: string;
	remaining: string;
	done: boolean;
}

interface RefactorState {
	active: boolean;
	target: string;
	passes: RefactorPass[];
	maxPasses: number;
	testCommand: string; // Shell command to run tests after each pass
	autoCommit: boolean; // Whether to commit+push on completion
}

// ─── Default state factory ─────────────────────────────────────────────────

function defaultState(): RefactorState {
	return {
		active: false,
		target: "",
		passes: [],
		maxPasses: 10,
		testCommand: "",
		autoCommit: true,
	};
}

// ─── Text input dialog (reusable) ──────────────────────────────────────────

function makeTextInputDialog(
	title: string,
	hint: string,
	tui: any,
	theme: any,
	done: (value: string | null) => void,
) {
	let cachedLines: string[] | undefined;

	const editorTheme: EditorTheme = {
		borderColor: (s: string) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t: string) => theme.fg("accent", t),
			selectedText: (t: string) => theme.fg("accent", t),
			description: (t: string) => theme.fg("muted", t),
			scrollInfo: (t: string) => theme.fg("dim", t),
			noMatch: (t: string) => theme.fg("warning", t),
		},
	};

	const editor = new Editor(tui, editorTheme);
	editor.onSubmit = (value) => {
		const trimmed = value.trim();
		done(trimmed.length > 0 ? trimmed : null);
	};

	return {
		render(width: number): string[] {
			if (cachedLines) return cachedLines;
			const lines: string[] = [];
			const add = (s: string) => lines.push(truncateToWidth(s, width));
			add(theme.fg("accent", "─".repeat(width)));
			add(theme.fg("accent", theme.bold(`  🔄  ${title}`)));
			if (hint) add(theme.fg("dim", `  ${hint}`));
			lines.push("");
			for (const line of editor.render(width - 4)) add(`  ${line}`);
			lines.push("");
			add(theme.fg("dim", "  Enter to confirm  •  Esc to cancel"));
			add(theme.fg("accent", "─".repeat(width)));
			cachedLines = lines;
			return lines;
		},
		invalidate() {
			cachedLines = undefined;
		},
		handleInput(data: string) {
			if (matchesKey(data, Key.escape)) {
				done(null);
				return;
			}
			editor.handleInput(data);
			cachedLines = undefined;
			tui.requestRender();
		},
	};
}

// ─── Extension entry point ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let state: RefactorState = defaultState();

	// Bundle the companion skill with refactoring instructions
	pi.on("resources_discover", () => ({
		skillPaths: [join(baseDir, "refactor-loop/SKILL.md")],
	}));

	// ── State reconstruction from session branch ─────────────────────────────

	const reconstruct = (ctx: ExtensionContext) => {
		state = defaultState();
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message") continue;
			const msg = entry.message;
			if (msg.role === "toolResult" && msg.toolName === "refactor_pass") {
				const d = msg.details as RefactorState | undefined;
				if (d) state = d;
			}
		}
		// Update widget if session has active refactoring
		if (state.active) updateWidget(ctx);
		else ctx.ui.setWidget("refactor-loop", undefined);
	};

	pi.on("session_start", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_fork", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_e, ctx) => reconstruct(ctx));

	// ── Progress widget ──────────────────────────────────────────────────────

	function updateWidget(ctx: ExtensionContext) {
		ctx.ui.setWidget("refactor-loop", (_tui, theme) => ({
			render(width: number): string[] {
				if (!state.active) return [];
				const lines: string[] = [];
				const add = (s: string) => lines.push(truncateToWidth(s, width));
				const passCount = state.passes.length;
				const lastPass = state.passes[passCount - 1];

				add(theme.fg("accent", "─".repeat(width)));
				add(
					theme.fg("accent", theme.bold("  🔄 Refactor Pipeline")) +
						theme.fg("muted", `  Pass ${passCount}/${state.maxPasses}`),
				);
				add(theme.fg("dim", `  Target: ${state.target}`));
				// Show test command so user knows what's being verified
				if (state.testCommand) {
					add(theme.fg("dim", `  Tests: ${state.testCommand}`));
				}

				if (lastPass) {
					add(theme.fg("success", `  ✓ ${lastPass.change}`));
					if (lastPass.remaining && !lastPass.done) {
						add(theme.fg("warning", `  → Next: ${lastPass.remaining}`));
					}
					if (lastPass.done) {
						add(
							theme.fg(
								"success",
								theme.bold("  ✅ Pipeline complete — code is clean!"),
							),
						);
						if (state.autoCommit) {
							add(theme.fg("accent", "  📦 Committing & pushing changes..."));
						}
					}
				} else {
					add(theme.fg("warning", "  ⏳ Starting first pass..."));
				}

				add(theme.fg("accent", "─".repeat(width)));
				return lines;
			},
			invalidate() {},
		}));
	}

	// ── Git commit + push helper ─────────────────────────────────────────────

	async function commitAndPush(ctx: ExtensionContext): Promise<string> {
		// Build a descriptive commit message from all passes
		const passLines = state.passes
			.map((p) => `- Pass ${p.pass}: ${p.change}`)
			.join("\n");
		const commitMsg =
			`refactor: ${state.target} (${state.passes.length} passes)\n\n` +
			`Automated refactoring pipeline — all tests passed.\n\n` +
			`Changes:\n${passLines}`;

		const results: string[] = [];

		// Stage all changes
		const addResult = await pi.exec("git", ["add", "-A"], { timeout: 10_000 });
		if (addResult.code !== 0) {
			return `❌ git add failed: ${addResult.stderr}`;
		}

		// Check if there's anything to commit
		const statusResult = await pi.exec("git", ["status", "--porcelain"], {
			timeout: 10_000,
		});
		if (!statusResult.stdout.trim()) {
			return "ℹ️ Nothing to commit — working tree is clean.";
		}

		// Commit
		const commitResult = await pi.exec("git", ["commit", "-m", commitMsg], {
			timeout: 30_000,
		});
		if (commitResult.code !== 0) {
			return `❌ git commit failed: ${commitResult.stderr}`;
		}
		results.push(`✅ Committed: ${commitResult.stdout.split("\n")[0]}`);

		// Push
		const pushResult = await pi.exec("git", ["push"], { timeout: 60_000 });
		if (pushResult.code !== 0) {
			results.push(`⚠️ git push failed: ${pushResult.stderr}`);
		} else {
			results.push("✅ Pushed to remote");
		}

		return results.join("\n");
	}

	// ── refactor_pass tool ───────────────────────────────────────────────────

	pi.registerTool({
		name: "refactor_pass",
		label: "Refactor Pass",
		description:
			"Report a refactoring pass result during the refactor pipeline. Call this after each analyze→refactor→verify cycle. " +
			"You MUST run the test command and confirm tests pass BEFORE calling this tool. " +
			"Set done=true when no more meaningful simplifications exist.",
		parameters: Type.Object({
			change: Type.String({ description: "What was changed in this pass" }),
			reason: Type.String({
				description: "Why this simplification improves the code",
			}),
			remaining: Type.String({
				description: "What simplification opportunities remain (empty if done)",
			}),
			done: Type.Boolean({
				description: "True if code is clean and no more passes needed",
			}),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [
						{
							type: "text",
							text: "Error: No active refactoring session. Use /refactor to start one.",
						},
					],
					isError: true,
				};
			}

			// Record this pass
			const pass: RefactorPass = {
				pass: state.passes.length + 1,
				change: params.change,
				reason: params.reason,
				remaining: params.remaining,
				done: params.done,
			};
			state.passes.push(pass);

			if (ctx) updateWidget(ctx);

			// Decide whether to continue the loop
			const passNum = state.passes.length;
			const hitMax = passNum >= state.maxPasses;
			const isDone = params.done || hitMax;

			let responseText: string;

			if (isDone) {
				// Pipeline complete
				state.active = false;
				const summary = state.passes
					.map((p) => `  Pass ${p.pass}: ${p.change} (${p.reason})`)
					.join("\n");
				responseText = `✅ Refactoring pipeline complete after ${passNum} pass(es).\n\nSummary:\n${summary}`;

				if (hitMax && !params.done) {
					responseText += `\n\n⚠️ Reached max passes (${state.maxPasses}). Use /refactor to continue if needed.`;
				}

				// Auto commit+push if enabled
				if (state.autoCommit && ctx) {
					updateWidget(ctx); // Show "committing" state
					const gitResult = await commitAndPush(ctx);
					responseText += `\n\n---\n\n## Git\n${gitResult}`;
				}

				// Clear widget after a delay
				if (ctx) {
					setTimeout(() => ctx.ui.setWidget("refactor-loop", undefined), 5000);
				}
			} else {
				// Continue — prompt the next pass
				const testReminder = state.testCommand
					? `\n\n⚠️ IMPORTANT: After making your change, run \`${state.testCommand}\` and confirm all tests pass BEFORE calling refactor_pass.`
					: "";
				responseText =
					`Pass ${passNum} complete: ${params.change}\n` +
					`Remaining: ${params.remaining}\n\n` +
					`Continue with pass ${passNum + 1}. Follow the refactor-loop skill instructions: ` +
					`analyze the next simplification opportunity, apply ONE focused change, verify with tests, then call refactor_pass again.` +
					testReminder;
			}

			return {
				content: [{ type: "text", text: responseText }],
				details: { ...state } as RefactorState, // Persist for reconstruction
			};
		},

		// Custom rendering
		renderCall(args, theme) {
			const icon = args.done ? "✅" : "🔄";
			return new Text(
				theme.fg("toolTitle", theme.bold(`${icon} refactor_pass `)) +
					theme.fg("muted", args.change?.slice(0, 60) || ""),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const d = result.details as RefactorState | undefined;
			if (!d) return new Text("", 0, 0);

			const passCount = d.passes.length;
			const icon = d.active ? "🔄" : "✅";
			let text = theme.fg("success", `${icon} ${passCount} pass(es)`);

			if (expanded && d.passes.length > 0) {
				for (const p of d.passes) {
					const pIcon = p.done ? "✓" : "→";
					text += `\n  ${pIcon} Pass ${p.pass}: ${p.change}`;
					text += `\n    ${theme.fg("dim", p.reason)}`;
				}
			}

			return new Text(text, 0, 0);
		},
	});

	// ── /refactor command ────────────────────────────────────────────────────

	pi.registerCommand("refactor", {
		description:
			"Start an iterative refactoring/simplification pipeline on a target",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			let target = args?.trim();

			// If no args, prompt the user for what to refactor
			if (!target) {
				target = await ctx.ui.custom<string | null>((tui, theme, _kb, done) =>
					makeTextInputDialog(
						"Refactor Pipeline",
						"What should be refactored? (file path, function name, module, etc.)",
						tui,
						theme,
						done,
					),
				);
			}

			if (!target) {
				ctx.ui.notify("Refactoring cancelled.", "info");
				return;
			}

			// Ask for test command
			const testCommand = await ctx.ui.custom<string | null>(
				(tui, theme, _kb, done) =>
					makeTextInputDialog(
						"Test Command",
						"Command to verify each pass (e.g. bun test, npm test, pytest). Leave empty to skip.",
						tui,
						theme,
						done,
					),
			);

			// Ask for max passes
			const maxStr = await ctx.ui.select("Max refactoring passes?", [
				"3 — Quick cleanup",
				"5 — Standard",
				"10 — Deep refactor",
				"20 — Thorough overhaul",
			]);

			if (!maxStr) {
				ctx.ui.notify("Refactoring cancelled.", "info");
				return;
			}

			const maxPasses = parseInt(maxStr) || 5;

			// Ask about auto commit+push
			const autoCommit = await ctx.ui.confirm(
				"Auto commit & push?",
				"Automatically git commit and push all changes when the pipeline completes?",
			);

			// Initialize state
			state = {
				active: true,
				target,
				passes: [],
				maxPasses,
				testCommand: testCommand ?? "",
				autoCommit,
			};

			updateWidget(ctx);

			const testInfo = state.testCommand
				? ` | tests: \`${state.testCommand}\``
				: " | no test command";
			const commitInfo = autoCommit
				? " | auto commit+push"
				: " | no auto commit";
			ctx.ui.notify(
				`🔄 Starting refactor pipeline on: ${target} (max ${maxPasses} passes${testInfo}${commitInfo})`,
				"info",
			);

			// Build the initial prompt with test instructions
			const testInstructions = state.testCommand
				? `\n\n## Test Verification\nAfter EVERY change, you MUST run: \`${state.testCommand}\`\n` +
					`If tests fail, revert your change and try a different approach.\n` +
					`NEVER call refactor_pass unless all tests are passing.`
				: "";

			const commitNote = autoCommit
				? "\n\nWhen the pipeline completes, changes will be automatically committed and pushed to git."
				: "";

			pi.sendUserMessage(
				`Start the refactor-loop pipeline on: ${target}\n\n` +
					`Follow the refactor-loop skill instructions. Run up to ${maxPasses} iterative passes.\n` +
					`Each pass: analyze → apply ONE focused simplification → run tests → call refactor_pass tool.\n` +
					`Keep going until the code is clean or you hit the pass limit.\n` +
					`Start with pass 1 now — read the target code and identify the first simplification.` +
					testInstructions +
					commitNote,
			);
		},
	});

	// ── /refactor-stop command ───────────────────────────────────────────────

	pi.registerCommand("refactor-stop", {
		description: "Stop the active refactoring pipeline",
		handler: async (_args, ctx) => {
			if (!state.active) {
				ctx.ui.notify("No active refactoring pipeline.", "info");
				return;
			}

			const passCount = state.passes.length;
			state.active = false;

			ctx.ui.setWidget("refactor-loop", undefined);
			ctx.ui.notify(
				`🛑 Refactoring pipeline stopped after ${passCount} pass(es).`,
				"info",
			);
		},
	});

	// ── System prompt injection when pipeline is active ──────────────────────

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;

		const passInfo =
			state.passes.length > 0
				? `\nCompleted passes:\n${state.passes.map((p) => `- Pass ${p.pass}: ${p.change}`).join("\n")}`
				: "";

		const testSection = state.testCommand
			? `\n\n## Test Command\nRun after EVERY change: \`${state.testCommand}\`\nDo NOT call refactor_pass if tests fail. Fix or revert first.`
			: "";

		const commitSection = state.autoCommit
			? `\n\nChanges will be auto-committed and pushed when the pipeline completes.`
			: "";

		return {
			systemPrompt:
				event.systemPrompt +
				`\n\n## Active Refactoring Pipeline\n` +
				`Target: ${state.target}\n` +
				`Pass: ${state.passes.length + 1} of ${state.maxPasses}\n` +
				`${passInfo}` +
				testSection +
				commitSection +
				`\n\nYou MUST follow the refactor-loop skill instructions. After each change, verify with tests, then call the refactor_pass tool to report results and continue the loop.`,
		};
	});
}
