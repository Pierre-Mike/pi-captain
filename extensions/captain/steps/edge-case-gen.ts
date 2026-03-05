// ── Step: Edge Case Test Generation ───────────────────────────────────────
// Generates adversarial and boundary tests for existing modules

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const edgeCaseGen: Step = {
	kind: "step",
	label: "Edge Case Tests",
	agent: "red-team",
	description: "Generate adversarial edge-case and boundary tests",
	prompt:
		"You are a red-team tester writing adversarial test cases.\n\n" +
		"Think like an attacker or malicious user. For each module in the coverage analysis:\n" +
		"1. Boundary values: MAX_SAFE_INTEGER, -1, 0, empty arrays, huge strings\n" +
		"2. Type confusion: passing wrong types, symbols, circular references\n" +
		"3. Concurrency: simultaneous calls, race conditions\n" +
		"4. Resource exhaustion: very large inputs, deep nesting\n" +
		"5. Unicode edge cases: RTL text, emoji, null bytes, surrogate pairs\n" +
		"6. Injection: SQL, HTML, shell metacharacters in user inputs\n\n" +
		"Use `import { test, expect, describe } from 'bun:test'`.\n" +
		"Name tests clearly: `test('handles <edge case> gracefully')`\n" +
		"Tests should verify the code doesn't crash — it should handle edges gracefully.\n\n" +
		"Coverage analysis:\n$INPUT\n\nProject context:\n$ORIGINAL",
	// Gate: edge case tests must pass (code should handle them)
	gate: command("bun test"),
	onFail: retry(3),
	transform: { kind: "full" },
};
