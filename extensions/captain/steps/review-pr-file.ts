// ── Step: Review PR File ──────────────────────────────────────────────────
// Layer 5 of github-pr-review (pool): Per-file code review.
// Each instance reviews one changed file for: correctness, security issues,
// code quality, style, and suggests inline comments. Run in a pool so
// all files are reviewed in parallel — results merged via concat.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const reviewPrFile: Step = {
	kind: "step",
	label: "Review PR File",
	agent: "reviewer",
	description:
		"Review a single changed file for correctness, security, quality — emit inline comments",
	prompt:
		"You are a senior code reviewer. Review this changed file from the PR.\n\n" +
		"PR metadata and changed file:\n$INPUT\n\n" +
		"Review the diff for:\n\n" +
		"1. **Correctness** — logic errors, off-by-one errors, missing error handling, race conditions\n" +
		"2. **Security** — injection risks, auth bypass, secret exposure, unsafe deserialization\n" +
		"3. **Code quality** — naming clarity, function length, duplication, coupling\n" +
		"4. **Type safety** — any 'any' casts, missing null checks, incorrect types\n" +
		"5. **Tests** — are the changes covered? are existing tests still valid?\n\n" +
		"For each finding:\n\n" +
		"### FINDING-N: [title]\n" +
		"- File: [path]\n" +
		"- Line: [line number or range]\n" +
		"- Severity: [CRITICAL|HIGH|MEDIUM|LOW|INFO]\n" +
		"- Category: [correctness|security|quality|types|tests]\n" +
		"- Issue: [clear description]\n" +
		"- Suggestion: [concrete fix or improvement]\n" +
		"- Inline comment: [GitHub PR comment text, ready to post]\n\n" +
		"End with:\n" +
		"FILE: [path]\n" +
		"FINDINGS: N\n" +
		"CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
