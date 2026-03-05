// ── Pipeline: API Design ──────────────────────────────────────────────────
// Design → user approval gate → implement → parallel(docs + tests) → review.
// The user gate ensures the API design is approved before implementation begins.
// Uses a fallback step on the integration test to generate stubs if tests can't run.
//
// Structure:
//   sequential
//   ├── step: API Design (gate: assert endpoint definitions)
//   ├── step: User Approval (gate: user — human reviews the design)
//   ├── step: API Implementation (gate: tsc --noEmit, retry 3)
//   ├── parallel (merge: concat)
//   │   ├── step: API Documentation (gate: file docs/api.md)
//   │   └── step: Integration & Tests (gate: bun test, onFail: fallback)
//   └── step: Code Review (transform: summarize)
// Agents: architect, backend-dev, tester, doc-writer, reviewer (from ~/.pi/agent/agents/*.md)

import { bunTest, fallback, skip, user } from "../gates/index.js";
import {
	apiDesignStep,
	apiDocs,
	apiImplementation,
	codeReview,
	integrationTests,
} from "../steps/index.js";
import type { Runnable, Step } from "../types.js";

/** Fallback step: generates test stubs if actual tests can't pass yet */
const testStubFallback: Step = {
	kind: "step",
	label: "Generate Test Stubs",
	agent: "tester",
	description: "Generate test stubs when integration tests can't run yet",
	prompt:
		"The integration tests couldn't run. Generate test stubs with `test.todo()` " +
		"for each API endpoint so the test structure exists for future implementation.\n\n" +
		"Use `import { test, describe } from 'bun:test'`.\n" +
		"Implementation details:\n$INPUT\n\nAPI requirements:\n$ORIGINAL",
	gate: { type: "none" },
	onFail: skip,
	transform: { kind: "full" },
};

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Design the API contract
		apiDesignStep,

		// 2. Human approval gate — user reviews the design before implementation
		{
			kind: "step",
			label: "Approve API Design",
			agent: "architect",
			description: "Present the API design for human approval",
			prompt:
				"Present the following API design for approval. Summarize the key decisions:\n" +
				"- Number of endpoints and their purposes\n" +
				"- Auth strategy chosen\n" +
				"- Any trade-offs made\n\n" +
				"API Design:\n$INPUT",
			gate: user, // ← human approval required
			onFail: { action: "retry", max: 5 }, // allow up to 5 revision rounds
			transform: { kind: "full" },
		},

		// 3. Implement the API
		apiImplementation,

		// 4. Parallel: generate docs + run tests
		{
			kind: "parallel",
			steps: [
				apiDocs,
				{
					// Integration tests with a fallback to stubs if they can't run
					...integrationTests,
					gate: bunTest,
					onFail: fallback(testStubFallback),
				},
			],
			merge: { strategy: "concat" },
		},

		// 5. Final review
		codeReview,
	],
};
