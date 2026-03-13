// handoff/index.ts — Generate a handoff prompt for the next AI agent
//
// Usage:
//   /handoff                        — LLM summarises the session and generates a handoff prompt
//   /handoff <custom instructions>  — same, but appended to the standard instructions
//
// Flow:
//   1. Command sends a special user message asking the LLM to write a handoff prompt
//   2. When the agent turn ends, the last assistant message is captured
//   3. The captured prompt is saved to a temp file
//   4. A new session is started (clear context)
//   5. On session_start the temp file is detected, read, deleted, and placed in the editor

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

// Temp file used to survive newSession() + reload()
const HANDOFF_FILE = path.join(os.tmpdir(), "pi-handoff-prompt.txt");

// Promise resolver set by the /handoff command; resolved inside agent_end
let handoffResolve: ((text: string) => void) | null = null;
let handoffReject: ((err: Error) => void) | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

type RawEntry = {
	type: string;
	message?: { role?: string; content?: unknown };
};

function extractLastAssistantText(ctx: ExtensionContext): string | null {
	const branch = ctx.sessionManager.getBranch() as RawEntry[];
	// Walk backwards to find the last assistant message with text content
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const msg = entry.message;
		if (!msg || msg.role !== "assistant") continue;

		const content = msg.content;
		if (!Array.isArray(content)) continue;

		const text = content
			.filter(
				(c): c is { type: string; text: string } =>
					c?.type === "text" && typeof c.text === "string",
			)
			.map((c) => c.text)
			.join("\n")
			.trim();

		if (text) return text;
	}
	return null;
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── On session_start: inject saved handoff prompt into the editor ────
	pi.on("session_start", async (_e, ctx) => {
		if (!fs.existsSync(HANDOFF_FILE)) return;

		try {
			const prompt = fs.readFileSync(HANDOFF_FILE, "utf-8").trim();
			fs.unlinkSync(HANDOFF_FILE);

			if (!prompt) return;

			if (ctx.hasUI) {
				ctx.ui.setEditorText(prompt);
				ctx.ui.notify(
					"Handoff prompt loaded into editor — review and press Enter to start",
					"info",
				);
			}
		} catch {
			// Best-effort — ignore read/delete errors
		}
	});

	// ── Capture the LLM response after the handoff turn ─────────────────
	pi.on("agent_end", async (_e, ctx) => {
		if (!handoffResolve) return;

		const resolve = handoffResolve;
		const reject = handoffReject;
		handoffResolve = null;
		handoffReject = null;

		const text = extractLastAssistantText(ctx);
		if (text) {
			resolve(text);
		} else {
			reject?.(
				new Error("Could not extract assistant response — no text found"),
			);
		}
	});

	// ── /handoff command ─────────────────────────────────────────────────
	pi.registerCommand("handoff", {
		description:
			"Ask the LLM to write a handoff prompt for the next agent, then start a fresh session",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const extraInstructions = args?.trim() ?? "";

			const prompt = [
				"## Handoff Prompt Request",
				"",
				"Generate a comprehensive, self-contained handoff prompt that the next AI agent can use to continue this work seamlessly.",
				"",
				"The prompt MUST include:",
				"- **Context**: what project/codebase we are working in and its structure",
				"- **Accomplished**: everything that has been done in this session",
				"- **Current state**: exact state of the code, files, or system right now",
				"- **Next steps**: clear, prioritised list of what still needs to be done",
				"- **Constraints & decisions**: any important choices already made or things to avoid",
				"- **How to start**: the first concrete action the next agent should take",
				"",
				...(extraInstructions
					? [`Additional instructions: ${extraInstructions}`, ""]
					: []),
				"Write ONLY the handoff prompt — no preamble, no commentary, no markdown code fences around it.",
				"Start directly with the context. The output will be pasted verbatim as the first message to the next agent.",
			].join("\n");

			// Set up the resolve/reject pair before sending the message
			const handoffDone = new Promise<string>((resolve, reject) => {
				handoffResolve = resolve;
				handoffReject = reject;
			});

			ctx.ui.notify("Asking the LLM to generate a handoff prompt…", "info");
			pi.sendUserMessage(prompt);

			let handoffText: string;
			try {
				// agent_end will resolve this — we wait here
				handoffText = await handoffDone;
			} catch (err) {
				handoffResolve = null;
				handoffReject = null;
				ctx.ui.notify(`Handoff failed: ${(err as Error).message}`, "error");
				return;
			}

			// Persist the prompt so it survives the upcoming reload()
			try {
				fs.writeFileSync(HANDOFF_FILE, handoffText, "utf-8");
			} catch (err) {
				ctx.ui.notify(
					`Could not save handoff file: ${(err as Error).message}`,
					"error",
				);
				return;
			}

			ctx.ui.notify("Handoff prompt saved — starting fresh session…", "info");

			// Clear context and reload (mirrors the /clear extension)
			await ctx.newSession();
			await ctx.reload();
		},
	});
}
