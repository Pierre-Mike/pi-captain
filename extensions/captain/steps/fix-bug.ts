// ── Step: Fix Bug ─────────────────────────────────────────────────────────
// Applies the proposed fix from the diagnosis step

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const fixBug: Step = {
	kind: "step",
	label: "Fix Bug",
	agent: "backend-dev",
	description: "Apply the diagnosed fix to the codebase",
	prompt:
		"You are a developer tasked with fixing a bug. The root cause has been identified.\n\n" +
		"1. Apply the exact code changes described in the diagnosis\n" +
		"2. Ensure the fix doesn't break adjacent functionality\n" +
		"3. Add a code comment explaining why the fix is needed\n" +
		"4. If the fix requires multiple files, change them all\n" +
		"5. List every file you modified and what you changed\n\n" +
		"Diagnosis:\n$INPUT\n\nOriginal bug report:\n$ORIGINAL",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
