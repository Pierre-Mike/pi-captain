// ── Step: Diagnose Bug ────────────────────────────────────────────────────
// Traces the root cause using reproduction output and source analysis

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a senior debugger. A bug has been reproduced with the following details.

1. Trace the execution path that leads to the failure
2. Identify the root cause (not just symptoms)
3. Determine which file(s) and function(s) contain the defect
4. Explain WHY the bug occurs (race condition, off-by-one, null ref, etc.)
5. Propose a specific fix with the exact code changes needed

Reproduction output:
$INPUT

Original bug report:
$ORIGINAL
`;

export const diagnoseBug: Step = {
	kind: "step",
	label: "Diagnose Bug",
	tools: ["read", "bash"],
	description: "Trace the root cause of the reproduced bug",
	prompt,
	// Gate: diagnosis must identify a specific file
	gate: ({ output }) =>
		output.includes("/") || output.includes(".ts") || output.includes(".js")
			? true
			: "Diagnosis must reference a specific file path",
	onFail: retry,
	transform: { kind: "full" },
};
