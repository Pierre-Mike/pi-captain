// ── ui/commands.ts — Slash command registration entry point ───────────────
// Wires together the two register halves (a + b) into a single call.
// Each half is ≤200 lines — split for Basic_knowledge.md §Single Responsibility.

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CaptainState } from "../state.js";
import { registerCommandsA } from "./commands-register-a.js";
import { registerCommandsB } from "./commands-register-b.js";

export function registerCommands(pi: ExtensionAPI, state: CaptainState): void {
	registerCommandsA(pi, state);
	registerCommandsB(pi, state);
}
