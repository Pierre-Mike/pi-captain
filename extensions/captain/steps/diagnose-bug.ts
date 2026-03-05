// ── Step: Diagnose Bug ────────────────────────────────────────────────────
// Traces the root cause using reproduction output and source analysis

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const diagnoseBug: Step = {
	kind: "step",
	label: "Diagnose Bug",
	agent: "architect",
	description: "Trace the root cause of the reproduced bug",
	prompt:
		"You are a senior debugger. A bug has been reproduced with the following details.\n\n" +
		"1. Trace the execution path that leads to the failure\n" +
		"2. Identify the root cause (not just symptoms)\n" +
		"3. Determine which file(s) and function(s) contain the defect\n" +
		"4. Explain WHY the bug occurs (race condition, off-by-one, null ref, etc.)\n" +
		"5. Propose a specific fix with the exact code changes needed\n\n" +
		"Reproduction output:\n$INPUT\n\nOriginal bug report:\n$ORIGINAL",
	// Gate: diagnosis must identify a specific file and root cause
	gate: assert(
		"output.includes('/') || output.includes('.ts') || output.includes('.js')",
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
