// ── Step: Risk Assessment ─────────────────────────────────────────────────
// Evaluates the voted migration strategy for risks and produces a go/no-go recommendation

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const riskAssessment: Step = {
	kind: "step",
	label: "Risk Assessment",
	agent: "plan-reviewer",
	description:
		"Evaluate the chosen migration strategy and produce a go/no-go recommendation",
	prompt:
		"You are a senior engineering manager reviewing a migration strategy.\n\n" +
		"1. Evaluate the strategy for completeness and feasibility\n" +
		"2. Identify risks not addressed in the plan\n" +
		"3. Score each risk: likelihood (1-5) × impact (1-5) = risk score\n" +
		"4. Check for missing rollback procedures\n" +
		"5. Verify testing coverage is adequate\n" +
		"6. Produce a final recommendation: GO / GO_WITH_CONDITIONS / NO_GO\n\n" +
		"Format:\n" +
		"## Recommendation: <GO|GO_WITH_CONDITIONS|NO_GO>\n" +
		"## Risk Matrix\n<table of risks with scores>\n" +
		"## Conditions (if applicable)\n" +
		"## Missing Items\n\n" +
		"Chosen migration strategy:\n$INPUT\n\nOriginal context:\n$ORIGINAL",
	// Gate: must include a recommendation
	gate: assert(
		"output.includes('GO') || output.includes('Recommendation') || output.includes('recommendation')",
	),
	onFail: retry(2),
	transform: { kind: "summarize" },
};
