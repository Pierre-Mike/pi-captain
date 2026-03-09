// ── Step: Re-Shred Failed Units ──────────────────────────────────────────
// Fallback step for validation: re-splits units that failed the single-pass
// dry-run into smaller sub-units until all are Haiku-safe.

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are the Shrinker. The previous validation step found units that cannot be executed
in a single pass. Your job is to re-split those failing units into smaller, simpler sub-units.

Validation output (contains FAILED UNITS list):
$INPUT

Instructions:
1. Parse the FAILED UNITS list from the validation output
2. For each failed unit, decompose it into 2-3 smaller sub-units that ARE single-pass executable
3. Preserve all passing units exactly as they are
4. Update dependency references: any unit that depended on a split unit should depend on its children
5. Re-score all new sub-units to confirm composite ≤ 2

Output ALL units (passing originals + new sub-units) in the same format:

### UNIT-N: name
- Goal: one sentence
- Input: what it receives
- Output: what it produces
- Acceptance Test: how to verify
- Dependencies: none or UNIT-X
- Token: X | Decision: X | Reasoning: X
- Composite: X — PASS

End with TOTAL UNITS: count
`;

export const reShred: Step = {
	kind: "step",
	label: "Re-Shred Failed Units",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.1,
	description:
		"Extract failed unit names from validation output and re-decompose them into smaller units",
	prompt,
	onFail: retry(1),
	transform: full,
};
