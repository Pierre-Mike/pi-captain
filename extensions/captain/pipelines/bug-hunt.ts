// ── Pipeline: Bug Hunt ────────────────────────────────────────────────────
// Reproduce → diagnose → fix → verify — the full bug lifecycle.
// Gated by `bun test` at the end to confirm the fix doesn't regress.
//
// Structure:
//   sequential (gate: bun test, retry 2) ← retries if tests fail after fix
//   ├── step: Reproduce Bug
//   ├── step: Diagnose Bug
//   ├── step: Fix Bug
//   └── step: Verify Fix (gate: bun test, retry 3)
// Agents: tester, architect, backend-dev (from ~/.pi/agent/agents/*.md)

import { bunTest, retry } from "../gates/index.js";
import {
	diagnoseBug,
	fixBug,
	reproduceBug,
	verifyFix,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Reproduce the bug with a minimal test case
		reproduceBug,

		// 2. Trace the root cause from reproduction output
		diagnoseBug,

		// 3. Apply the fix
		fixBug,

		// 4. Verify the fix resolves the bug (has its own bun test gate)
		verifyFix,
	],

	// Sequence-level gate: full test suite must pass after all steps
	gate: bunTest,
	onFail: retry(2),
};
