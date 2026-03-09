// ── Step: EARS Structure ─────────────────────────────────────────────────
// Stage 1 of req-decompose: Transform a raw requirement into EARS-structured
// (Easy Approach to Requirements Syntax) statements that are individually
// testable: "While [precondition], when [trigger], the [system] shall [response]."

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are a Requirements Analyst expert in EARS notation (Easy Approach to Requirements Syntax).

Raw requirement:
$ORIGINAL

Transform this requirement into structured EARS statements:

EARS patterns:
- Ubiquitous: 'The [system] shall [response]'
- Event-driven: 'When [trigger], the [system] shall [response]'
- State-driven: 'While [precondition], the [system] shall [response]'
- Conditional: 'Where [feature], the [system] shall [response]'
- Optional feature: 'Where [optional feature], the [system] shall [response]'

For each EARS requirement:

### REQ-N: [name]
- Pattern: [ubiquitous | event-driven | state-driven | conditional]
- EARS: [full EARS statement]
- Precondition: [or 'none']
- Trigger: [or 'none']
- System: [the component/system]
- Response: [the expected behaviour]
- Assumptions: [if any ambiguity was resolved — state what you assumed]

Rules:
- Each statement must be independently testable
- Expose all implicit preconditions
- One behaviour per statement (no 'and' combining multiple responses)
- If the requirement is vague, make reasonable assumptions and note them

End with:
TOTAL REQUIREMENTS: N
`;

export const earsStructure: Step = {
	kind: "step",
	label: "EARS Structure",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.3,
	description:
		"Transform raw requirement into testable EARS-structured statements",
	prompt,
	onFail: retry,
	transform: full,
};
