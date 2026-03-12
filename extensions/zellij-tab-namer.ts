/**
 * Zellij Tab Namer Extension
 *
 * Automatically renames the Zellij tab based on a short summary of
 * the conversation after each agent turn. Uses a fast/cheap model
 * to generate a concise 3-5 word label.
 *
 * Requirements:
 *   - Running inside a Zellij session (auto-detected via ZELLIJ env var)
 *   - An available model for summary generation
 *
 * The tab name is updated after each agent turn and on session restore.
 * On shutdown, the tab name is reset via `zellij action undo-rename-tab`.
 */

import { execSync } from "node:child_process";
import { complete, getModel } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

type ContentBlock = {
	type?: string;
	text?: string;
};

type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

const isInZellij = (): boolean => process.env.ZELLIJ !== undefined;

const renameZellijTab = (name: string): void => {
	try {
		// Truncate to 30 chars max to keep the tab bar readable
		const truncated = name.length > 30 ? `${name.slice(0, 27)}...` : name;
		execSync(`zellij action rename-tab "${truncated.replace(/"/g, '\\"')}"`, {
			stdio: "ignore",
			timeout: 2000,
		});
	} catch {
		// Silently fail — tab rename is best-effort
	}
};

const undoRenameZellijTab = (): void => {
	try {
		execSync("zellij action undo-rename-tab", {
			stdio: "ignore",
			timeout: 2000,
		});
	} catch {
		// Silently fail
	}
};

const extractConversationSnippet = (
	entries: SessionEntry[],
	maxMessages = 6,
): string => {
	const parts: string[] = [];

	// Take last N user/assistant messages for context
	const relevant = entries
		.filter(
			(e) =>
				e.type === "message" &&
				(e.message?.role === "user" || e.message?.role === "assistant"),
		)
		.slice(-maxMessages);

	for (const entry of relevant) {
		const role = entry.message?.role === "user" ? "User" : "Assistant";
		const content = entry.message?.content;

		let text = "";
		if (typeof content === "string") {
			text = content;
		} else if (Array.isArray(content)) {
			text = content
				.filter(
					(c: ContentBlock) => c?.type === "text" && typeof c.text === "string",
				)
				.map((c: ContentBlock) => c.text)
				.join(" ");
		}

		if (text.trim()) {
			// Keep each message short to save tokens
			const trimmed = text.trim().slice(0, 200);
			parts.push(`${role}: ${trimmed}`);
		}
	}

	return parts.join("\n");
};

const generateTabLabel = async (
	conversationSnippet: string,
	modelRegistry: ExtensionContext["modelRegistry"],
): Promise<string | null> => {
	// Try fast/cheap models in order of preference
	const modelCandidates = [
		["anthropic", "claude-haiku-4-5"],
		["google", "gemini-2.0-flash"],
		["openai", "gpt-4.1-mini"],
		["anthropic", "claude-sonnet-4-5"],
	] as const;

	for (const [provider, id] of modelCandidates) {
		try {
			const model = getModel(provider, id);
			if (!model) continue;

			const apiKey = await modelRegistry.getApiKey(model);
			if (!apiKey) continue;

			const response = await complete(
				model,
				{
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: [
										"Generate a very short label (3-5 words max) summarizing what this conversation is about.",
										"The label will be used as a terminal tab name, so keep it extremely concise.",
										"Use lowercase, no quotes, no punctuation. Just the core topic.",
										"Examples: 'auth middleware refactor', 'fix upload bug', 'setup ci pipeline', 'add user search'",
										"",
										"<conversation>",
										conversationSnippet,
										"</conversation>",
										"",
										"Tab label:",
									].join("\n"),
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey },
			);

			const label = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text.trim())
				.join("")
				.replace(/^["']|["']$/g, "") // Strip quotes
				.replace(/\.$/g, "") // Strip trailing period
				.trim();

			return label || null;
		} catch {}
	}

	return null;
};

// Debounce to avoid rapid-fire renames during multi-turn sequences
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastLabel = "";

const scheduleRename = (
	entries: SessionEntry[],
	ctx: ExtensionContext,
	delay = 1500,
): void => {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}

	debounceTimer = setTimeout(async () => {
		try {
			const snippet = extractConversationSnippet(entries);
			if (!snippet.trim()) return;

			const label = await generateTabLabel(snippet, ctx.modelRegistry);
			if (label && label !== lastLabel) {
				lastLabel = label;
				renameZellijTab(`π ${label}`);
			}
		} catch {
			// Best-effort — never crash on tab rename failure
		}
	}, delay);
};

export default function (pi: ExtensionAPI) {
	if (!isInZellij()) {
		return; // Not in Zellij — nothing to do
	}

	// Set initial title on session start
	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getBranch() as SessionEntry[];
		if (entries.length > 0) {
			// Existing session — generate label from history
			scheduleRename(entries, ctx, 500);
		}
	});

	// Update tab name after each agent turn
	pi.on("agent_end", async (_event, ctx) => {
		const entries = ctx.sessionManager.getBranch() as SessionEntry[];
		scheduleRename(entries, ctx);
	});

	// Reset tab name on shutdown
	pi.on("session_shutdown", async () => {
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		undoRenameZellijTab();
	});
}
