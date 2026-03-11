// ── Captain: Agent Orchestration Pipeline Extension ────────────────────────
// Composable, type-safe multi-agent pipelines with sequential, parallel, and
// pool execution patterns, git worktree isolation, gates, and merge strategies.
//
// Entry point — wires together state, tools, UI, and commands.
// See: state.ts | tools/ | ui/ | utils/ | executor.ts | types.ts

import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CaptainState } from "./state.js";

import { registerDefineTool } from "./tools/define.js";
import { registerGenerateTool } from "./tools/generate.js";
import { registerListTool } from "./tools/list.js";
import { registerLoadTool } from "./tools/load.js";
import { registerRunTool } from "./tools/run.js";
import { registerStatusTool } from "./tools/status.js";
import { registerValidateTool } from "./tools/validate.js";
import { registerCommands } from "./ui/commands.js";
import { clearWidget, updateWidget } from "./ui/widget.js";

const baseDir = (() => {
	try {
		return new URL(".", import.meta.url).pathname;
	} catch {
		return process.cwd();
	}
})();

export default function (pi: ExtensionAPI) {
	const state = new CaptainState(baseDir);

	// ── Contract File ──────────────────────────────────────────────────────
	// Write .pi/pipelines/captain.ts so pipeline authors get IDE autocomplete.
	try {
		state.ensureCaptainContractFile(process.cwd());
	} catch {
		/* best-effort — don't crash if .pi/ isn't writable */
	}

	// ── Bundled Prompts ────────────────────────────────────────────────────
	pi.on("resources_discover", () => ({
		promptPaths: [join(baseDir, "prompts", "orchestrate.md")],
	}));

	// ── Register Tools ─────────────────────────────────────────────────────
	registerDefineTool(pi, state);
	registerGenerateTool(pi, state);
	registerLoadTool(pi, state);
	registerRunTool(pi, state, updateWidget, clearWidget);
	registerStatusTool(pi, state);
	registerListTool(pi, state);
	registerValidateTool(pi, state);

	// ── Register Slash Commands ────────────────────────────────────────────
	registerCommands(pi, state);
}
