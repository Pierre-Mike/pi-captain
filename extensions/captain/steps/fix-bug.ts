// ── Step: Fix Bug ─────────────────────────────────────────────────────────
// Applies the proposed fix from the diagnosis step

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a developer tasked with fixing a bug. The root cause has been identified.

1. Apply the exact code changes described in the diagnosis
2. Ensure the fix doesn't break adjacent functionality
3. Add a code comment explaining why the fix is needed
4. If the fix requires multiple files, change them all
5. List every file you modified and what you changed

Diagnosis:
$INPUT

Original bug report:
$ORIGINAL
`;

export const fixBug: Step = {
	kind: "step",
	label: "Fix Bug",
	tools: ["read", "bash", "edit", "write"],
	description: "Apply the diagnosed fix to the codebase",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
