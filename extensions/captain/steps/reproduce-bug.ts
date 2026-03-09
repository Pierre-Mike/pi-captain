// ── Step: Reproduce Bug ───────────────────────────────────────────────────
// Attempts to reproduce the reported bug with a minimal test case

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a QA engineer. Your task is to reproduce a reported bug.

1. Read the bug report carefully
2. Examine the relevant source files
3. Write a minimal test case or script that reliably triggers the bug
4. Run it and confirm the failure
5. Document the exact steps to reproduce, the expected vs actual behavior,
   and the stack trace or error output

Bug report:
$ORIGINAL
`;

export const reproduceBug: Step = {
	kind: "step",
	label: "Reproduce Bug",
	tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	description: "Create a minimal reproduction of the reported bug",
	prompt,
	// Gate: output must include reproduction evidence
	gate: assert(
		"output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('reproduce')",
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
