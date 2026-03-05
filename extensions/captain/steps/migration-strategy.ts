// ── Step: Migration Strategy ──────────────────────────────────────────────
// Proposes a detailed migration path (used in pool×3 for diverse approaches)

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const migrationStrategy: Step = {
	kind: "step",
	label: "Migration Strategy",
	agent: "planner",
	description:
		"Propose a detailed migration strategy with steps, risks, and rollback plan",
	prompt:
		"You are a migration planner. Based on the dependency audit, propose a UNIQUE migration strategy.\n\n" +
		"Consider one of these approaches (pick the one not yet covered):\n" +
		"- Big-bang migration: convert everything at once with a feature branch\n" +
		"- Strangler-fig: gradually replace old with new behind feature flags\n" +
		"- Parallel-run: run old and new side-by-side, compare outputs\n\n" +
		"Your strategy MUST include:\n" +
		"1. Step-by-step migration plan with ordering\n" +
		"2. Estimated effort per step (hours/days)\n" +
		"3. Risk assessment for each step\n" +
		"4. Rollback procedure if something breaks\n" +
		"5. Testing approach to validate each step\n" +
		"6. Required downtime (if any)\n\n" +
		"Dependency audit:\n$INPUT\n\nMigration context:\n$ORIGINAL",
	// Gate: strategy must be detailed enough
	gate: outputMinLength(300),
	onFail: retry(2),
	transform: { kind: "full" },
};
