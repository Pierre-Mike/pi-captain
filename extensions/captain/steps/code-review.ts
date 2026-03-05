// ── Step: Code Review ─────────────────────────────────────────────────────
// Final quality review — fails if any critical issues are found

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const codeReview: Step = {
	kind: "step",
	label: "Code Review",
	agent: "reviewer",
	description: "Final quality review",
	prompt:
		"You are a senior code reviewer. Review the entire implementation for:\n" +
		"- Code quality and best practices\n- Security vulnerabilities\n" +
		"- Performance issues\n- Missing error handling\n- Documentation gaps\n\n" +
		"Provide a structured review with severity levels (critical/warning/info).\n\n" +
		"Implementation:\n$INPUT\n\nOriginal request: $ORIGINAL",
	gate: none,
	onFail: skip,
	transform: { kind: "summarize" },
};
