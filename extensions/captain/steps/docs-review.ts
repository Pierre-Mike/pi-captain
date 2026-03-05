// ── Step: Documentation Review ────────────────────────────────────────────
// Reviews all generated docs for accuracy, completeness, and readability

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const docsReview: Step = {
	kind: "step",
	label: "Documentation Review",
	agent: "reviewer",
	description: "Review generated documentation for accuracy and completeness",
	prompt:
		"You are a technical editor reviewing auto-generated documentation.\n\n" +
		"1. Read all generated docs (docs/*.md)\n" +
		"2. Cross-reference against the actual source code for accuracy\n" +
		"3. Check for:\n" +
		"   - Outdated or incorrect code examples\n" +
		"   - Missing sections (installation, config, error handling)\n" +
		"   - Broken links or references\n" +
		"   - Inconsistent terminology\n" +
		"   - Readability: clear headings, logical flow, appropriate detail level\n" +
		"4. Fix any issues you find directly in the doc files\n" +
		"5. Report what you fixed and any remaining concerns\n\n" +
		"Generated docs summary:\n$INPUT\n\nProject context:\n$ORIGINAL",
	// Gate: review must be substantive
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "summarize" },
};
