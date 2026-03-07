// ── Captain: Agent Orchestration Pipeline Extension ────────────────────────
// Composable, type-safe multi-agent pipelines with sequential, parallel, and
// pool execution patterns, git worktree isolation, gates, and merge strategies.
//
// Entry point — wires together state, tools, UI, and commands.
// See: state.ts | tools/ | ui/ | utils/ | executor.ts | types.ts

import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { CaptainState } from "./state.js";
import { registerAgentTool } from "./tools/agent.js";
import { registerDefineTool } from "./tools/define.js";
import { registerGenerateTool } from "./tools/generate.js";
import { registerListTool } from "./tools/list.js";
import { registerLoadTool } from "./tools/load.js";
import { registerRunTool } from "./tools/run.js";
import { registerStatusTool } from "./tools/status.js";
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
	const state = new CaptainState();

	// ── Session Reconstruction ─────────────────────────────────────────────
	const reconstruct = (ctx: Parameters<Parameters<typeof pi.on>[1]>[1]) => {
		state.reconstruct(ctx as Parameters<typeof state.reconstruct>[0]);
	};
	pi.on("session_start", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_fork", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_e, ctx) => reconstruct(ctx));

	// ── Bundled Skill ──────────────────────────────────────────────────────
	pi.on("resources_discover", () => ({
		skillPaths: [join(baseDir, "skill", "SKILL.md")],
		promptPaths: [join(baseDir, "prompts", "orchestrate.md")],
	}));

	// ── Register Tools ─────────────────────────────────────────────────────
	registerAgentTool(pi, state);
	registerDefineTool(pi, state);
	registerLoadTool(pi, state);
	registerRunTool(pi, state, updateWidget, clearWidget);
	registerStatusTool(pi, state);
	registerListTool(pi, state);
	registerGenerateTool(pi, state);

	// ── Register Slash Commands ────────────────────────────────────────────
	registerCommands(pi, state);

	// ── Session Start: Footer + Welcome Notify ─────────────────────────────
	pi.on("session_start", async (_e, ctx) => {
		ctx.ui.notify(
			"Captain loaded — pipeline orchestration ready\n\n" +
				"/captain-help                         All commands\n" +
				"/captain-run <name> <input>           Run pipeline directly\n" +
				"/captain-run <name> --step <l> <i>    Run one step from pipeline\n" +
				"/captain-step <prompt> [--agent ...]  Run ad-hoc single step\n" +
				"/captain-load <name>                  Load a preset",
			"info",
		);

		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id ?? "no-model";
				const usage = ctx.getContextUsage?.();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const pipelineCount = Object.keys(state.pipelines).length;
				const agentCount = Object.keys(state.agents).length;
				const left =
					theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", `${pipelineCount} pipeline(s)`) +
					theme.fg("muted", " · ") +
					theme.fg("dim", `${agentCount} agent(s)`);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(
					Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
				);
				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}
