// ── Step: Decompose ──────────────────────────────────────────────────────
// Stage 2 of shredder: Recursively split a structured spec into atomic,
// self-contained, testable sub-tasks with dependency tracking.

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Decomposer. Take this structured spec and break it into atomic sub-tasks.

Spec:
$INPUT

Before decomposing, scan the codebase to understand the project context:
1. Run: find . -type f -name '*.ts' -o -name '*.js' -o -name '*.py' | head -50
2. Run: cat package.json 2>/dev/null || cat Cargo.toml 2>/dev/null || cat pyproject.toml 2>/dev/null || echo 'no manifest found'
3. Identify existing modules, patterns, and test files relevant to this spec

Map each sub-task to specific files/functions/modules when possible.
Include a 'Files' field for each unit listing the files that will be created or modified.

Rules for each sub-task:
- Self-contained: no hidden dependencies
- Single-responsibility: exactly one clear outcome
- Testable: include a pass/fail acceptance test

For each sub-task output:

### UNIT-N: name
- Goal: one sentence
- Input: what it receives
- Output: what it produces
- Acceptance Test: how to verify
- Dependencies: none or UNIT-X (comma-separated if multiple)
- Files: (list of files to create/modify)

Decompose further if a sub-task needs multi-step reasoning.
End with TOTAL UNITS: count
`;

export const decompose: Step = {
	kind: "step",
	label: "Decompose",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.2,
	description: "Recursively split the spec into atomic sub-tasks",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
