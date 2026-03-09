// ── Step: Edge Case Test Generation ───────────────────────────────────────
// Generates adversarial and boundary tests for existing modules

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a red-team tester writing adversarial test cases.

Think like an attacker or malicious user. For each module in the coverage analysis:
1. Boundary values: MAX_SAFE_INTEGER, -1, 0, empty arrays, huge strings
2. Type confusion: passing wrong types, symbols, circular references
3. Concurrency: simultaneous calls, race conditions
4. Resource exhaustion: very large inputs, deep nesting
5. Unicode edge cases: RTL text, emoji, null bytes, surrogate pairs
6. Injection: SQL, HTML, shell metacharacters in user inputs

Use \`import { test, expect, describe } from 'bun:test'\`.
Name tests clearly: \`test('handles <edge case> gracefully')\`
Tests should verify the code doesn't crash — it should handle edges gracefully.

Coverage analysis:
$INPUT

Project context:
$ORIGINAL
`;

export const edgeCaseGen: Step = {
	kind: "step",
	label: "Edge Case Tests",
	tools: ["read", "bash", "grep", "find", "ls"],
	description: "Generate adversarial edge-case and boundary tests",
	prompt,
	// Gate: edge case tests must pass (code should handle them)
	gate: command("bun test"),
	onFail: retry(3),
	transform: { kind: "full" },
};
