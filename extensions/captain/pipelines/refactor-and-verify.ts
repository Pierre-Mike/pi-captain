// ── Pipeline: Refactor and Verify ─────────────────────────────────────────
// Analyze → parallel(refactor + write regression tests) → verify with test+typecheck.
// The parallel block writes regression tests in one branch while refactoring in another,
// then the sequence-level gate ensures everything compiles and passes.
//
// Structure:
//   sequential (gate: bun test && tsc --noEmit, retry 2)
//   ├── step: Analyze Codebase
//   ├── parallel (merge: awaitAll)
//   │   ├── step: Refactor Code
//   │   └── step: Write Regression Tests (gate: bun test)
//   └── step: Code Review (transform: summarize)
// Agents: architect, backend-dev, tester, reviewer (from ~/.pi/agent/agents/*.md)

import { retry, testAndTypecheck } from "../gates/index.js";
import {
	analyzeCodebase,
	codeReview,
	refactorCode,
	writeRegressionTests,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Deep analysis of current code and refactoring plan
		analyzeCodebase,

		// 2. Parallel: refactor code + write regression tests simultaneously
		// Both branches receive the analysis as $INPUT
		{
			kind: "parallel",
			steps: [refactorCode, writeRegressionTests],
			merge: { strategy: "awaitAll" },
		},

		// 3. Final code review of refactored code
		codeReview,
	],

	// Sequence-level gate: tests must pass AND TypeScript must compile
	gate: testAndTypecheck,
	onFail: retry(2),
};
