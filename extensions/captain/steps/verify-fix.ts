// ── Step: Verify Fix ──────────────────────────────────────────────────────
// Runs the reproduction test again to confirm the bug is resolved

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a QA engineer verifying a bug fix.

1. Re-run the original reproduction test case
2. Confirm the bug is now fixed (expected behavior matches actual)
3. Run the full test suite to check for regressions
4. Summarize: FIXED or STILL_BROKEN, with evidence

Fix details:
$INPUT

Original bug report:
$ORIGINAL
`;

export const verifyFix: Step = {
	kind: "step",
	label: "Verify Fix",
	tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	description: "Confirm the fix resolves the bug and no regressions introduced",
	prompt,
	// Gate: test suite must pass after the fix
	gate: command("bun test"),
	onFail: retry,
	transform: { kind: "full" },
};
