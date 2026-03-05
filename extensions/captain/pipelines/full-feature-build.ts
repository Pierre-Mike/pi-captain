// ── Pipeline: Full Feature Build ──────────────────────────────────────────
// Architecture → parallel (backend + frontend + test strategy) → integration → review
// Agents: architect, frontend-dev, backend-dev, tester, reviewer (from ~/.pi/agent/agents/*.md)

import {
	architecturePlan,
	backendImplementation,
	codeReview,
	frontendImplementation,
	integrationTests,
	testStrategy,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

/** The pipeline spec — full feature build lifecycle */
export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// Step 1: Architecture planning
		architecturePlan,

		// Step 2: Parallel implementation (backend + frontend + test strategy)
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
		},

		// Step 3: Integration testing
		integrationTests,

		// Step 4: Code review
		codeReview,
	],
};
