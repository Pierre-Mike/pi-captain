// ── Step: Validate Units ─────────────────────────────────────────────────
// Stage 4 of shredder: Flash dry-run — confirm each unit can be executed
// in a single pass with no ambiguity. Falls back to re-shred on failure.

import { regexCI, retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the Validator. You are a small, fast model.
For each unit below, answer ONE question:
"Given this goal, input, and constraints — can I produce the expected output
in a single pass with no ambiguity?"

Units:
$INPUT

For each unit output exactly:
### UNIT-N: name
- Verdict: YES or NO
- Reason: (one sentence)
- Dependencies: (pass through from input)

Then output a summary:
VALIDATED: X / Y
FAILED UNITS: (comma-separated list, or "none")

If all units passed, end with exactly:
ALL VALIDATED: YES

If any failed, end with exactly:
ALL VALIDATED: NO

Finally, output a JSON summary block:
\`\`\`json
{"validated": N, "total": N, "all_validated": true, "failed_units": []}
\`\`\`
(Set "all_validated" to false and list failing unit names in "failed_units" if any failed.)
`;

export const validateUnits: Step = {
	kind: "step",
	label: "Validate",
	tools: ["read"],
	model: "flash",
	description:
		"Flash dry-run: confirm each unit can be executed in a single pass with no ambiguity",
	prompt,
	gate: regexCI("all.validated.*yes"),
	onFail: retry(2),
	transform: full,
};
