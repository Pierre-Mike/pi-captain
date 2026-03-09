// ── Step: TDD Red — Write Failing Tests ──────────────────────────────────
// Stage 2 of spec-tdd: Tester writes comprehensive tests from the spec.
// Tests MUST FAIL because no implementation exists yet.

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the TDD Red Tester. Your job is to write tests that will FAIL
because the implementation does not exist yet.

Technical Specification:
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Read the spec carefully — every acceptance criterion becomes at least one test
2. Examine the existing test framework and patterns in the codebase:
   - Run: find . -name '*.test.*' -o -name '*.spec.*' | head -20
   - Read an existing test file to match the style
3. Write test files following the project's conventions
4. Include tests for:
   - Every requirement in the spec
   - Every acceptance criterion
   - Every edge case listed
   - Error handling / invalid inputs
   - Type safety (if TypeScript)
5. Use descriptive test names: \`it('should reject empty input with TypeError')\`
6. Import from the paths specified in the spec (even though they don't exist yet)
7. Run the tests with \`bun test\` — they MUST FAIL

CRITICAL: Do NOT write any implementation code. Only test files.
The tests must fail because the implementation doesn't exist, NOT because the tests are broken.

After writing, run \`bun test\` and confirm failures. Report:
- Total tests written
- All tests failing: YES
- TEST FILES: (list of test files created)
`;

export const tddRed: Step = {
	kind: "step",
	label: "TDD Red — Write Failing Tests",
	tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	temperature: 0.2,
	description:
		"Write comprehensive test suites from the spec. Tests MUST fail (no implementation yet).",
	prompt,
	// Gate: tests must exit non-zero (all failing = success for RED phase)
	gate: command("bun test 2>&1; test $? -ne 0"),
	onFail: retry(2),
	transform: { kind: "full" },
	maxTurns: 15,
};
