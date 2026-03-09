// ── Step: Fix Review Issues ──────────────────────────────────────────────
// Fallback step for code review: fixes critical issues found by the reviewer,
// then re-verifies tests pass.

import { allOf, bunTest, regexCI, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Review Fixer. The code review found CRITICAL issues that must be fixed.

Review output:
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Read the review output and identify all 🔴 CRITICAL issues
2. For each critical issue:
   a. Read the file mentioned
   b. Apply the minimal, targeted fix
   c. Run \`bun test\` to ensure nothing breaks
3. Address 🟡 WARNING issues if the fix is straightforward
4. Run \`bun test\` one final time
5. Report what was fixed:
   - FIXES APPLIED: N
   - All tests passing: YES
   - REVIEW PASSED: YES
`;

export const fixReviewIssues: Step = {
	kind: "step",
	label: "Fix Review Issues",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	temperature: 0.2,
	description:
		"Fix critical issues found during code review, then re-verify tests pass",
	prompt,
	// Gate: tests must pass + review issues resolved
	gate: allOf(bunTest, regexCI("review.passed.*yes")),
	onFail: retry,
	transform: { kind: "full" },
	maxTurns: 20,
};
