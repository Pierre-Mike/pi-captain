/**
 * Helper functions and types for Zellij tab naming extension
 */

import { execSync } from "node:child_process";
import {
	type Api,
	complete,
	getModel,
	type KnownProvider,
	type Model,
} from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ContentBlock = {
	type?: string;
	text?: string;
};

export type SessionEntry = {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
};

export const renameZellijTab = (name: string): void => {
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

export const undoRenameZellijTab = (): void => {
	try {
		execSync("zellij action undo-rename-tab", {
			stdio: "ignore",
			timeout: 2000,
		});
	} catch {
		// Silently fail
	}
};

export const extractConversationSnippet = (
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

export const generateTabLabel = async (
	conversationSnippet: string,
	modelRegistry: ExtensionContext["modelRegistry"],
): Promise<string | null> => {
	// Try fast/cheap models in order of preference
	const modelCandidates: Array<[KnownProvider, string]> = [
		["anthropic", "claude-haiku-4-5"],
		["google", "gemini-2.0-flash"],
		["openai", "gpt-4.1-mini"],
		["anthropic", "claude-sonnet-4-5"],
	];

	for (const [provider, id] of modelCandidates) {
		try {
			// getModel generic can't be narrowed per-provider across a union loop;
			// cast the function signature to accept loose string args.
			const model = (getModel as (p: KnownProvider, id: string) => Model<Api>)(
				provider,
				id,
			);
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
		} catch {
			// Try next model
		}
	}

	return null;
};

// Debounce to avoid rapid-fire renames during multi-turn sequences
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastLabel = "";

export const scheduleRename = (
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

export const clearDebounceTimer = (): void => {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
};
