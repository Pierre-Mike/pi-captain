// ── Tool Resolver: map agent tool name strings → AgentTool instances ──────
// Used by executeStep() to provide tools to the agentic loop.
// Each call creates tools scoped to the step's cwd (worktree path for pool/parallel).

import type { AgentTool } from "@mariozechner/pi-agent-core";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";

// Factory map: tool name → creator function scoped to a cwd
const BUILTIN_FACTORIES: Record<string, (cwd: string) => AgentTool> = {
	read: (cwd) => createReadTool(cwd),
	bash: (cwd) => createBashTool(cwd),
	edit: (cwd) => createEditTool(cwd),
	write: (cwd) => createWriteTool(cwd),
	grep: (cwd) => createGrepTool(cwd),
	find: (cwd) => createFindTool(cwd),
	ls: (cwd) => createLsTool(cwd),
};

/**
 * Resolve tool name strings to executable AgentTool instances.
 *
 * @param toolNames - Agent's tools field, e.g. ["read", "bash", "edit"]
 * @param cwd - Working directory for path resolution (worktree path in pool/parallel)
 * @param extensionTools - Optional map of custom tools from extensions
 * @returns Array of AgentTool instances ready for agentLoop
 */
export function resolveTools(
	toolNames: string[],
	cwd: string,
	extensionTools?: Map<string, AgentTool>,
): AgentTool[] {
	if (!toolNames || toolNames.length === 0) return [];

	const resolved: AgentTool[] = [];

	for (const name of toolNames) {
		const trimmed = name.trim();

		// 1. Try built-in tool factory
		const factory = BUILTIN_FACTORIES[trimmed];
		if (factory) {
			resolved.push(factory(cwd));
			continue;
		}

		// 2. Try extension-provided tools
		const extTool = extensionTools?.get(trimmed);
		if (extTool) {
			resolved.push(extTool);
		}

		// 3. Unknown — skip silently (don't crash the pipeline).
		// The step will still produce text output, just without this tool.
	}

	return resolved;
}
