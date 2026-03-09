// ── Step: Contract Tasks ─────────────────────────────────────────────────
// Stage 4 of req-decompose-ai: The critical last-mile step.
// Converts each BDD scenario into a fully typed AI execution contract
// using the "prompt as contract" pattern (input schema + constraints +
// output shape + verification command + pre-written test stub).
//
// Output is UNIT-N compatible so shredder's shredAndScore, resolveDependencies,
// generateExecutionSpec, and renderCanvas all work unchanged downstream.

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are a Contract Generator applying the 'prompt as contract' pattern.

BDD scenarios:
$INPUT

Original requirement:
$ORIGINAL

STEP 1 — Ground yourself in the codebase to extract real types and signatures:
1. Run: find . -type f \\( -name '*.ts' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \\) | grep -v node_modules | grep -v dist | grep -v .git | head -80
2. For each file area mentioned in the stories, read the relevant source files to extract:
   - Existing type/interface definitions
   - Existing function signatures
   - Test framework in use (jest/vitest/pytest/etc)
3. Run: cat package.json 2>/dev/null | grep -E '(test|jest|vitest|mocha)' || echo 'check other manifest'

STEP 2 — For each BDD scenario, produce ONE UNIT-N contract.

Rules:
- One unit = one function = one test = one commit
- Use REAL types from the codebase (no 'any', no 'object', no vague names)
- File paths must be explicit and grounded in the actual directory structure
- Pre-written test must be copy-pasteable and immediately runnable
- Verification command must be a real shell command

For each BDD scenario produce exactly:

### UNIT-N: [functionName]
- Goal: [one sentence — what this function does]
- Traceability: STORY-X → SCENARIO N.X → [scenario name]
- Function: \`[functionName]([param]: [InputType]): [ReturnType]\`
- File: \`[src/path/to/file.ts]\` [create | modify]
- Layer: [business-logic | data-access | api | ui | utility]
- Input schema:
  \`\`\`
  { field: Type, field2: Type, ... }
  \`\`\`
- Output shape:
  \`\`\`
  { field: Type } | throws [ErrorType]
  \`\`\`
- Constraints:
  1. [invariant or rule that must hold]
  2. [error case to handle]
  (one line per constraint — these are the guard rails for the AI)
- Pre-written test:
  \`\`\`[language]
  describe('[functionName]', () => {
    it('[scenario name]', () => {
      // Given
      const input = [concrete value, not abstract placeholder]
      // When
      const result = [functionName](input)
      // Then
      expect(result).[matcher]([expected concrete value])
    })
  })
  \`\`\`
- Verification: \`[exact shell command to run this test]\`
- Acceptance Test: [Given/When/Then from BDD — one line summary]
- Dependencies: [UNIT-X, UNIT-Y or none]

After all units end with:
TOTAL UNITS: N
ALL CONTRACTS TYPED: YES / NO
`;

export const contractTasks: Step = {
	kind: "step",
	label: "Contract Tasks",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.2,
	description:
		"Convert BDD scenarios into typed AI execution contracts (prompt-as-contract pattern, UNIT-N format)",
	prompt,
	onFail: retry,
	transform: full,
};
