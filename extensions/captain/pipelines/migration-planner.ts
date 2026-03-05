// ── Pipeline: Migration Planner ───────────────────────────────────────────
// Audit → pool×3 strategies (vote merge for consensus) → risk assessment.
// Three independent agents each propose a different migration approach,
// then LLM voting picks the best one, and a reviewer does the risk check.
//
// Structure:
//   sequential
//   ├── step: Audit Dependencies
//   ├── pool ×3 (merge: vote) ← three strategies, best-of-3 consensus
//   │   └── step: Migration Strategy (outputMinLength 300, retry 2)
//   └── step: Risk Assessment (transform: summarize)
// Agents: architect, planner, plan-reviewer (from ~/.pi/agent/agents/*.md)

import {
	auditDependencies,
	migrationStrategy,
	riskAssessment,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Audit current state of dependencies
		auditDependencies,

		// 2. Pool: 3 agents each propose a different migration strategy
		// Vote merge selects the consensus best approach
		{
			kind: "pool",
			step: migrationStrategy,
			count: 3,
			merge: { strategy: "vote" },
		},

		// 3. Risk assessment on the voted-best strategy
		riskAssessment,
	],
};
