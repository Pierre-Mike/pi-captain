// ── Step: Code Review ────────────────────────────────────────────────────
// Stage 4 of spec-tdd: Reviewer audits implementation, tests, and docs.
// Produces a structured verdict with severity-rated issues.
// On failure (critical issues found), falls back to review-fix step.

import { allOf, bunTest, fallback, llmFast, regexCI } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";
import { fixReviewIssues } from "./fix-review-issues.js";

const prompt = `
You are the Code Reviewer. Conduct a thorough code review of the implementation.

Context from previous steps:
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Read ALL implementation files that were created/modified
2. Read ALL test files
3. Read ALL documentation files
4. Run \`bun test\` to confirm tests still pass
5. Run \`find . -name '*.ts' | xargs grep -l 'TODO\\|FIXME\\|HACK\\|XXX'\` to find shortcuts

Review checklist:

## Code Quality
- [ ] Follows existing codebase patterns and conventions
- [ ] No dead code, unused imports, or commented-out blocks
- [ ] Proper error handling (no swallowed errors)
- [ ] Types are correct and precise (no \`any\`)
- [ ] Functions are focused (single responsibility)

## Test Quality
- [ ] Every acceptance criterion has a test
- [ ] Edge cases are covered
- [ ] Test names are descriptive
- [ ] No flaky patterns (timeouts, race conditions)
- [ ] Tests actually assert meaningful things (not just \`expect(true)\`)

## Documentation Quality
- [ ] API signatures match the implementation
- [ ] Examples are correct and runnable
- [ ] No stale or misleading information

## Security
- [ ] No exposed secrets or credentials
- [ ] Input validation on public APIs
- [ ] No path traversal, injection, or XSS risks

For each issue found, output:
- **[SEVERITY]** file:line — description — suggestion
  Severities: 🔴 CRITICAL | 🟡 WARNING | 🔵 INFO

End with:
## Verdict
- CRITICAL issues: N
- Warnings: N
- REVIEW PASSED: YES/NO
(PASSED only if zero CRITICAL issues)
`;

export const reviewCode: Step = {
	kind: "step",
	label: "Code Review",
	tools: ["read", "bash", "grep", "find", "ls"],
	temperature: 0.3,
	description:
		"Review implementation, tests, and documentation for quality and correctness",
	prompt,
	// Gate: tests pass + review passed + LLM confirms thoroughness
	gate: allOf(
		bunTest,
		regexCI("review.passed.*yes"),
		llmFast(
			"Does this review cover code quality, test quality, documentation, and security? " +
				"Does it give a clear PASSED/FAILED verdict with zero critical issues for PASSED? " +
				"Rate thoroughness 0-1. Threshold: 0.7",
		),
	),
	// Fallback: if review finds critical issues, hand off to fixer
	onFail: fallback(fixReviewIssues),
	transform: full,
	maxTurns: 15,
};
