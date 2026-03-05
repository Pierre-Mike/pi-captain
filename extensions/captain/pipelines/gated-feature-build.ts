// ── Pipeline: Gated Feature Build ─────────────────────────────────────────
// Same as full-feature-build but with composition gates:
// - The parallel implementation block is gated by typecheck
// - The full sequence is gated by `bun test`
// Demonstrates parameterized gate factories and composition-level gates.
// Agents: architect, frontend-dev, backend-dev, tester, reviewer (from ~/.pi/agent/agents/*.md)

import { bunTest, command, retry } from "../gates/index.js";
import {
	architecturePlan,
	backendImplementation,
	codeReview,
	frontendImplementation,
	integrationTests,
	testStrategy,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

/**
 * The pipeline spec — full feature build with composition gates.
 *
 * Structure:
 *   sequential (gate: bun test, retry 2) ← retries EVERYTHING if tests fail
 *   ├── step: Architecture Plan
 *   ├── parallel (gate: tsc --noEmit, retry 2) ← retries all branches if typecheck fails
 *   │   ├── step: Backend Implementation
 *   │   ├── step: Frontend Implementation
 *   │   └── pool ×2 (merge: rank)
 *   │       └── step: Test Strategy
 *   ├── step: Integration & Tests
 *   └── step: Code Review
 */
export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// Step 1: Architecture planning
		architecturePlan,

		// Step 2: Parallel implementation — gated by typecheck
		// If typecheck fails after merge, re-run all 3 branches
		{
			kind: "parallel",
			steps: [
				backendImplementation,
				frontendImplementation,
				{
					kind: "pool",
					step: testStrategy,
					count: 2,
					merge: { strategy: "rank" },
				},
			],
			merge: { strategy: "concat" },
			gate: command("bunx tsc --noEmit"), // ← parameterized gate factory
			onFail: retry(2), // ← parameterized onFail factory
		},

		// Step 3: Integration testing
		integrationTests,

		// Step 4: Code review
		codeReview,
	],

	// Gate the entire sequence — if tests fail after review, retry everything
	gate: bunTest, // ← preset constant (command("bun test"))
	onFail: retry(2),
};
