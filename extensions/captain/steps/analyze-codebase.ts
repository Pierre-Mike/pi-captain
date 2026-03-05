// ── Step: Analyze Codebase ─────────────────────────────────────────────────
// Deep analysis of code structure, complexity, and refactoring opportunities

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const analyzeCodebase: Step = {
	kind: "step",
	label: "Analyze Codebase",
	agent: "architect",
	description: "Analyze code structure and identify refactoring opportunities",
	prompt:
		"You are a senior software architect performing a codebase analysis.\n\n" +
		"1. Examine the files and modules relevant to the request\n" +
		"2. Identify code smells: duplication, long functions, deep nesting, god objects\n" +
		"3. Map dependencies between modules\n" +
		"4. Rank refactoring opportunities by impact (high/medium/low)\n" +
		"5. For each opportunity, describe the current state, proposed change, and risk level\n" +
		"6. Produce a prioritized refactoring plan with specific file paths\n\n" +
		"Request:\n$ORIGINAL",
	// Gate: analysis must be substantive (at least 200 chars)
	gate: outputMinLength(200),
	onFail: retry(2),
	transform: { kind: "full" },
};
