// ── Step: Generate Execution Pipeline ─────────────────────────────────────
// Stage 7 of shredder: Convert the task tree into an executable captain
// TypeScript pipeline file saved to .pi/pipelines/execution-pipeline.ts.

import { file, retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the Execution Pipeline Generator. Convert the task tree into a valid captain TypeScript pipeline file.

Task tree:
$INPUT

Original requirement:
$ORIGINAL

Instructions:
1. Map each execution layer to a parallel node (units within a layer run concurrently)
2. Map cross-layer dependencies to sequential ordering (layers run in order)
3. Assign tools/model to each unit based on its domain:
   - Code generation → tools: ["read","bash","edit","write"]
   - Testing         → tools: ["read","bash","edit","write"]
   - Documentation   → tools: ["read","bash","edit","write"]
   - Architecture    → tools: ["read","bash"]
   - Research        → tools: ["read","bash"]
   - Review          → tools: ["read","bash","grep","find","ls"]
4. Each unit becomes a Step; each layer becomes a Parallel node; the top-level is Sequential.

Write a complete TypeScript pipeline file to .pi/pipelines/execution-pipeline.ts using the write tool.

The file MUST start with these two header comments (no blank line before them):
// @name: execution-pipeline
// @description: <one-line description of what this pipeline builds>

Then ONLY these imports (no others):
import { retry, skip, warn, bunTest, command, file as fileGate, regexCI, full, summarize, concat, awaitAll, vote, rank } from "./captain.ts";
import type { Gate, OnFail, Runnable, Step } from "./captain.ts";

Step shape:
const myStep: Step = {
  kind: "step",
  label: "Human-readable name",
  model: "sonnet",          // or "flash" for fast/cheap steps
  tools: ["read", "bash", "edit", "write"],
  prompt: "Do X based on: $INPUT\\n\\nOriginal goal: $ORIGINAL\\n\\nIMPORTANT: Use only relative paths for all file operations.",
  gate: bunTest,            // or: command("npm test"), fileGate("dist/out.js"), regexCI("^ok"), undefined
  onFail: retry(3),         // or: skip, warn
  transform: full,          // or: summarize()
};

Composition:
// Sequential
export const pipeline: Runnable = { kind: "sequential", steps: [stepA, stepB, stepC] };
// Parallel (git worktree isolation — always use relative paths in prompts)
export const pipeline: Runnable = { kind: "parallel", steps: [frontendStep, backendStep], merge: concat };
// Pool (same step × N)
export const pipeline: Runnable = { kind: "pool", step: solveStep, count: 3, merge: vote };

The file MUST end with:
export const pipeline: Runnable = { ... };

Rules:
- Use $INPUT for previous step output, $ORIGINAL for the user's initial request
- Parallel/pool step prompts MUST include: "Use only relative paths for all file operations."
- Do NOT invent imports — only use what is listed above
- Do NOT add any text outside the TypeScript file
- Write the file to .pi/pipelines/execution-pipeline.ts
`;

export const generateExecutionSpec: Step = {
	kind: "step",
	label: "Generate Execution Pipeline",
	tools: ["read", "bash", "write"],
	model: "sonnet",
	description:
		"Convert the task tree into an executable captain TypeScript pipeline file",
	prompt,
	gate: file(".pi/pipelines/execution-pipeline.ts"),
	onFail: retry(),
	transform: full,
};
