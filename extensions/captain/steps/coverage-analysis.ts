// ── Step: Coverage Analysis ───────────────────────────────────────────────
// Analyzes existing test coverage and identifies gaps

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const coverageAnalysis: Step = {
	kind: "step",
	label: "Coverage Analysis",
	agent: "tester",
	description: "Analyze existing test coverage and identify gaps",
	prompt:
		"You are a test coverage analyst. Examine the project's test suite.\n\n" +
		"1. Find all existing test files and list them\n" +
		"2. Map each source file to its test file (or note if missing)\n" +
		"3. Read existing tests to understand what's covered\n" +
		"4. Identify uncovered source files (no tests at all)\n" +
		"5. Identify partially covered files (missing branches, error paths)\n" +
		"6. Prioritize gaps by risk: critical business logic > utilities > types\n\n" +
		"Produce a coverage gap report:\n" +
		"- File → Coverage Status → Priority → What's Missing\n\n" +
		"Project context:\n$ORIGINAL",
	// Gate: must produce a substantive analysis
	gate: outputMinLength(200),
	onFail: retry(2),
	transform: { kind: "full" },
};
