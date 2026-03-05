// ── Step: Reproduce Bug ───────────────────────────────────────────────────
// Attempts to reproduce the reported bug with a minimal test case

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const reproduceBug: Step = {
	kind: "step",
	label: "Reproduce Bug",
	agent: "tester",
	description: "Create a minimal reproduction of the reported bug",
	prompt:
		"You are a QA engineer. Your task is to reproduce a reported bug.\n\n" +
		"1. Read the bug report carefully\n" +
		"2. Examine the relevant source files\n" +
		"3. Write a minimal test case or script that reliably triggers the bug\n" +
		"4. Run it and confirm the failure\n" +
		"5. Document the exact steps to reproduce, the expected vs actual behavior, " +
		"and the stack trace or error output\n\n" +
		"Bug report:\n$ORIGINAL",
	// Gate: output must include reproduction evidence (error or failure description)
	gate: assert(
		"output.toLowerCase().includes('error') || output.toLowerCase().includes('fail') || output.toLowerCase().includes('reproduce')",
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
