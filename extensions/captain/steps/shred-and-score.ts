// ── Step: Shrink and Score ────────────────────────────────────────────────
// Stage 3 of shredder: Score each unit's complexity on three axes and
// re-split any unit above the Haiku-safe threshold (composite ≤ 2).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Shredder. Score each unit's complexity.

Units:
$INPUT

Score each on 1-5:
- Token Context (1=under 500 tokens, 2=under 1K, 3=under 2K, 4=under 4K, 5=over 4K)
- Decision Count (1=zero/one decision, 2=two, 3=three, 4=four+, 5=complex branching)
- Reasoning Depth (1=lookup/copy, 2=simple transform, 3=single inference, 4=chain of 2, 5=deep chain)

Composite = max of all three. Target: composite 2 or below (Haiku-safe).

For each unit:
### UNIT-N: name
- Token: X | Decision: X | Reasoning: X
- Composite: X — PASS or FAIL
- Dependencies: (preserve from input — none or UNIT-X)

For any FAIL unit, decompose it inline into smaller sub-units and re-score.
When splitting a unit, update dependency references: units that depended on the
split unit should depend on its children instead.
Repeat until every unit passes.

Output each unit in full — preserve ALL original contract fields (Goal, Traceability,
Function, File, Layer, Input schema, Output shape, Constraints, Pre-written test,
Verification, Acceptance Test, Dependencies) and append the score fields below them.
Do NOT strip any contract fields. Only the complexity scores and re-splits are new.

End with:
SHRUNKEN UNITS READY: count
ALL PASS: YES

Finally, output a JSON summary block:
\`\`\`json
{"total_units": N, "all_pass": true}
\`\`\`
`;

export const shredAndScore: Step = {
	kind: "step",
	label: "Shrink and Score",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.1,
	description:
		"Score complexity and re-split any unit above the Haiku-safe threshold",
	prompt,
	gate: none,
	onFail: retry(3),
	transform: { kind: "full" },
};
