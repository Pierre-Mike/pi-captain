// ── Step: TDD Green — Write Implementation ──────────────────────────────
// Stage 3a of spec-tdd: Builder writes the minimal implementation to make
// all failing tests pass. Does NOT modify test files.

import { bunTest, retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the TDD Green Builder. The tests already exist and are FAILING.
Your job is to write the MINIMAL implementation to make them PASS.

Previous step output (test results + spec context):
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Find and read the test files to understand exactly what's expected:
   - Run: find . -name '*.test.*' -o -name '*.spec.*' | head -20
   - Read each test file carefully
2. Read the existing codebase to match patterns and conventions
3. Write the MINIMAL code to make all tests pass:
   - Follow the public API signatures from the spec
   - Match the file paths specified in the spec
   - Don't add features beyond what the tests verify
4. Run \`bun test\` after each file you write
5. Iterate until ALL tests pass
6. Run \`bun test\` one final time and confirm:
   - All tests passing: YES
   - IMPLEMENTATION FILES: (list of files created/modified)

CRITICAL RULES:
- MINIMAL code only — if a test doesn't check for it, don't build it
- Do NOT modify any test files
- Clean, readable code following existing patterns
- Proper error handling as specified by the tests
- Run tests frequently — commit to green incrementally
`;

export const tddGreen: Step = {
	kind: "step",
	label: "TDD Green — Write Implementation",
	tools: ["read", "write", "edit", "bash", "grep", "find", "ls"],
	description:
		"Write the minimal implementation code to make all failing tests pass",
	prompt,
	// Gate: all tests must pass
	gate: bunTest,
	onFail: retry(),
	transform: full,
};
