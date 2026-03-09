// ── Step: Analyze Codebase ─────────────────────────────────────────────────
// Deep analysis of code structure, complexity, and refactoring opportunities

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a senior software architect performing a codebase analysis.

1. Examine the files and modules relevant to the request
2. Identify code smells: duplication, long functions, deep nesting, god objects
3. Map dependencies between modules
4. Rank refactoring opportunities by impact (high/medium/low)
5. For each opportunity, describe the current state, proposed change, and risk level
6. Produce a prioritized refactoring plan with specific file paths

Request:
$ORIGINAL
`;

export const analyzeCodebase: Step = {
	kind: "step",
	label: "Analyze Codebase",
	tools: ["read", "bash"],
	description: "Analyze code structure and identify refactoring opportunities",
	prompt,
	// Gate: analysis must be substantive (at least 200 chars)
	gate: ({ output }) =>
		output.length > 200 ? true : "Analysis output is too short (< 200 chars)",
	onFail: retry,
	transform: { kind: "full" },
};
