import { skip, warn } from "<captain>/gates/on-fail.js";
import { concat } from "<captain>/merge.js";
import { full, summarize } from "<captain>/transforms/presets.js";
import type { Runnable, Step } from "<captain>/types.js";

const analyze: Step = {
	kind: "step",
	label: "Analyze codebase",
	model: "sonnet",
	tools: ["read", "bash"],
	prompt: `Read and deeply understand the entire pi-captain codebase at /Users/pierre-mikel/Github/pi-captain/extensions/captain/.

Focus on:
1. extensions/captain/types.ts — all types (Step, Gate, OnFail, Transform, Sequential, Parallel, Pool, MergeFn, etc.)
2. extensions/captain/gates/presets.ts — every gate preset exported
3. extensions/captain/gates/on-fail.ts — every OnFail preset exported
4. extensions/captain/gates/llm.ts — LLM gate
5. extensions/captain/transforms/presets.ts — every transform preset exported
6. extensions/captain/merge.ts — every merge function exported
7. extensions/captain/tools/ — all tools (run.ts, load.ts, list.ts, status.ts, metrics.ts, define.ts, generate.ts)
8. extensions/captain/pipelines/index.ts — all builtin pipeline presets
9. extensions/captain/ui/commands.ts — all slash commands
10. extensions/captain/index.ts — what the extension registers

Produce a structured summary covering:
- All exported types with their fields
- All gate presets (name + description)
- All OnFail presets (name + description)
- All transform presets (name + description)
- All merge functions (name + description)
- All tools registered (name + description)
- All builtin pipeline presets (key + description)
- All slash commands (name + behavior)
- Any fields/features that exist in code but are NOT documented in the README or SKILL.md`,
	gate: ({ output }) => (output.length > 300 ? true : "Analysis too short"),
	onFail: skip,
	transform: full,
};

const updateReadme: Step = {
	kind: "step",
	label: "Update README.md",
	model: "sonnet",
	tools: ["read", "write"],
	prompt: `You are updating /Users/pierre-mikel/Github/pi-captain/README.md to be 100% accurate with the actual codebase.

Here is the full codebase analysis:
$INPUT

Here is the current README:
---
$(cat /Users/pierre-mikel/Github/pi-captain/README.md)
---

Rules:
- Keep the same overall structure and style
- Fix any inaccurate tool names (e.g. captain_define may no longer exist if removed)
- Add any missing gate presets, OnFail presets, transform presets, merge functions
- Update the builtin pipeline presets table to match what's actually in pipelines/index.ts
- Update slash commands to match ui/commands.ts
- Remove any docs for things that don't exist in code
- Add captain_metrics to the tools table if it's registered
- Keep all existing examples that are still correct; fix examples that are wrong
- Keep the install/dev/license sections unchanged
- Do NOT add todo/placeholder sections — only document what exists

Write the complete updated README.md to /Users/pierre-mikel/Github/pi-captain/README.md`,
	onFail: warn,
	transform: summarize(),
};

const updateSkill: Step = {
	kind: "step",
	label: "Update SKILL.md",
	model: "sonnet",
	tools: ["read", "write"],
	prompt: `You are updating /Users/pierre-mikel/Github/pi-captain/skills/captain/SKILL.md to be 100% accurate with the actual codebase.

Here is the full codebase analysis:
$INPUT

Here is the current SKILL.md:
---
$(cat /Users/pierre-mikel/Github/pi-captain/skills/captain/SKILL.md)
---

Rules:
- Keep the same format (frontmatter + markdown sections)
- The SKILL.md is what an AI agent reads to understand how to USE captain — focus on practical usage patterns
- Fix any inaccurate tool names or function signatures
- Update the tools table to match what's registered
- Update gate presets table (add missing ones, remove non-existent ones)
- Update OnFail presets table
- Update merge functions table
- Update slash commands section
- Keep the TypeScript pipeline example correct and representative
- Do NOT bloat it — keep it concise and agent-friendly

Write the complete updated SKILL.md to /Users/pierre-mikel/Github/pi-captain/skills/captain/SKILL.md`,
	onFail: warn,
	transform: summarize(),
};

const updateTodo: Step = {
	kind: "step",
	label: "Update TODO.md",
	model: "flash",
	tools: ["read", "write"],
	prompt: `You are updating /Users/pierre-mikel/Github/pi-captain/TODO.md.

Here is what's been confirmed implemented (from codebase analysis):
$INPUT

Read the current TODO.md at /Users/pierre-mikel/Github/pi-captain/TODO.md.

For each TODO item:
- If it's clearly implemented in the codebase (e.g. captain_metrics exists → "captain_metrics tool" is done), mark it [x] DONE or remove it
- If it's not implemented, keep it as-is
- Do not fabricate completions — only mark done what you can confirm from the analysis

Write the updated TODO.md to /Users/pierre-mikel/Github/pi-captain/TODO.md`,
	onFail: warn,
	transform: full,
};

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		analyze,
		{
			kind: "parallel",
			steps: [updateReadme, updateSkill],
			merge: concat,
		},
		updateTodo,
	],
};
