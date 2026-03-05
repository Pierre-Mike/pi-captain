// ── Pipeline: Test Coverage Boost ─────────────────────────────────────────
// Analyze coverage gaps → parallel(unit tests + edge case tests + integration tests)
// → verify all pass. Each parallel branch is gated by `bun test` independently,
// and the sequence-level gate ensures everything passes together.
//
// Structure:
//   sequential (gate: bun test, retry 2)
//   ├── step: Coverage Analysis (outputMinLength 200)
//   ├── parallel (merge: concat, gate: bun test, retry 2)
//   │   ├── step: Unit Test Generation (gate: bun test)
//   │   ├── step: Edge Case Tests (gate: bun test)
//   │   └── step: Integration & Tests (gate: bun test)
//   └── step: Code Review (transform: summarize)
// Agents: tester, red-team, reviewer (from ~/.pi/agent/agents/*.md)

import { bunTest, retry } from "../gates/index.js";
import {
	codeReview,
	coverageAnalysis,
	edgeCaseGen,
	integrationTests,
	unitTestGen,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Analyze current coverage and identify gaps
		coverageAnalysis,

		// 2. Parallel: three types of test generation from the same coverage analysis
		{
			kind: "parallel",
			steps: [
				unitTestGen, // Happy path + core behavior tests
				edgeCaseGen, // Adversarial boundary tests
				integrationTests, // Cross-module integration tests
			],
			merge: { strategy: "concat" },
			// Composition gate: all test types must pass together after merge
			gate: bunTest,
			onFail: retry(2),
		},

		// 3. Review the generated tests
		codeReview,
	],

	// Sequence-level gate: full test suite must pass
	gate: bunTest,
	onFail: retry(2),
};
