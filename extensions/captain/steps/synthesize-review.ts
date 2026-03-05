// ── Step: Synthesize Review ───────────────────────────────────────────────
// Merges all parallel review outputs into a single actionable review report

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const synthesizeReview: Step = {
	kind: "step",
	label: "Synthesize Review",
	agent: "synthesizer",
	description:
		"Combine parallel review findings into a unified, prioritized report",
	prompt:
		"You are a tech lead synthesizing multiple code review reports into one.\n\n" +
		"1. Deduplicate findings that appear across multiple reviews\n" +
		"2. Prioritize by severity: CRITICAL → HIGH → MEDIUM → LOW → NIT\n" +
		"3. Group related findings together\n" +
		"4. Produce a final verdict: APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION\n" +
		"5. Write a concise executive summary (2-3 sentences)\n" +
		"6. List all findings in priority order with clear action items\n\n" +
		"Format:\n" +
		"## Verdict: <APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION>\n" +
		"## Summary\n<executive summary>\n" +
		"## Findings\n<prioritized list>\n\n" +
		"Review reports:\n$INPUT\n\nOriginal context:\n$ORIGINAL",
	// Gate: must contain a verdict
	gate: outputMinLength(200),
	onFail: retry(2),
	transform: { kind: "full" },
};
