// ── Step: Write Regression Tests ──────────────────────────────────────────
// Creates tests that lock current behavior before/during refactoring

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const writeRegressionTests: Step = {
	kind: "step",
	label: "Write Regression Tests",
	agent: "tester",
	description:
		"Write regression tests to ensure refactoring doesn't break behavior",
	prompt:
		"You are a test engineer writing regression tests for a refactoring effort.\n\n" +
		"1. Read the codebase analysis to understand what's being refactored\n" +
		"2. Write tests that capture CURRENT behavior of the affected modules\n" +
		"3. Cover happy paths, error paths, and edge cases\n" +
		"4. Use `bun test` compatible test syntax (import { test, expect } from 'bun:test')\n" +
		"5. Run the tests and confirm they all pass BEFORE refactoring\n" +
		"6. List every test file created and what behavior it locks\n\n" +
		"Codebase analysis:\n$INPUT\n\nOriginal request:\n$ORIGINAL",
	// Gate: tests must pass — these lock existing behavior
	gate: command("bun test"),
	onFail: retry(3),
	transform: { kind: "full" },
};
