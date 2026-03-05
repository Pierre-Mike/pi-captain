// ── Step: Verify Fix ──────────────────────────────────────────────────────
// Runs the reproduction test again to confirm the bug is resolved

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const verifyFix: Step = {
	kind: "step",
	label: "Verify Fix",
	agent: "tester",
	description: "Confirm the fix resolves the bug and no regressions introduced",
	prompt:
		"You are a QA engineer verifying a bug fix.\n\n" +
		"1. Re-run the original reproduction test case\n" +
		"2. Confirm the bug is now fixed (expected behavior matches actual)\n" +
		"3. Run the full test suite to check for regressions\n" +
		"4. Summarize: FIXED or STILL_BROKEN, with evidence\n\n" +
		"Fix details:\n$INPUT\n\nOriginal bug report:\n$ORIGINAL",
	// Gate: test suite must pass after the fix
	gate: command("bun test"),
	onFail: retry(3),
	transform: { kind: "full" },
};
