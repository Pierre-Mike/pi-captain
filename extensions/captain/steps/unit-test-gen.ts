// ── Step: Unit Test Generation ─────────────────────────────────────────────
// Generates missing unit tests for uncovered modules

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const unitTestGen: Step = {
	kind: "step",
	label: "Unit Test Generation",
	agent: "tester",
	description: "Generate unit tests for modules identified as lacking coverage",
	prompt:
		"You are a test engineer writing unit tests to fill coverage gaps.\n\n" +
		"1. Focus on the highest-priority uncovered modules from the coverage analysis\n" +
		"2. Write tests using `import { test, expect, describe } from 'bun:test'`\n" +
		"3. For each function/method, test:\n" +
		"   - Happy path with typical inputs\n" +
		"   - Return value correctness\n" +
		"   - Type behavior (null, undefined, empty string)\n" +
		"4. Use descriptive test names: `test('functionName returns X when given Y')`\n" +
		"5. Mock external dependencies (file system, network, database)\n" +
		"6. Run the tests and ensure they pass\n\n" +
		"Coverage analysis:\n$INPUT\n\nProject context:\n$ORIGINAL",
	// Gate: all new tests must pass
	gate: command("bun test"),
	onFail: retry(3),
	transform: { kind: "full" },
};
