// ── Step: Quality Review ──────────────────────────────────────────────────
// Code quality review: readability, patterns, maintainability

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const qualityReview: Step = {
	kind: "step",
	label: "Quality Review",
	agent: "reviewer",
	description: "Review code quality, readability, and maintainability",
	prompt:
		"You are a senior code reviewer focused on quality and maintainability.\n\n" +
		"Evaluate:\n" +
		"1. Code readability and naming conventions\n" +
		"2. Function length and single-responsibility adherence\n" +
		"3. Error handling completeness (missing try/catch, unhandled promises)\n" +
		"4. Type safety (proper types vs `any`, missing null checks)\n" +
		"5. DRY violations and code duplication\n" +
		"6. Test coverage gaps for new/changed code\n" +
		"7. Documentation: missing JSDoc, outdated comments\n" +
		"8. Consistency with existing codebase patterns\n\n" +
		"For each finding, rate:\n" +
		"- Severity: MUST_FIX / SHOULD_FIX / NIT\n" +
		"- Location: file and line\n" +
		"- Suggestion with code example if applicable\n\n" +
		"Code to review:\n$INPUT\n\nContext:\n$ORIGINAL",
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
