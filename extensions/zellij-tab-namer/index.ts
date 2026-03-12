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

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	clearDebounceTimer,
	type SessionEntry,
	scheduleRename,
	undoRenameZellijTab,
} from "./helpers";

const isInZellij = (): boolean => process.env.ZELLIJ !== undefined;

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
		clearDebounceTimer();
		undoRenameZellijTab();
	});
}
