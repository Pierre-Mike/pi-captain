// ── Step: Capture and Clarify ─────────────────────────────────────────────
// Stage 1 of shredder: Transform a raw requirement into a structured,
// unambiguous specification with inputs, outputs, acceptance criteria.

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Clarifier. Take this raw requirement and produce a structured spec.

Requirement:
$ORIGINAL

Produce a spec in this exact format:

## STRUCTURED SPEC

### Title
(concise name)

### Inputs
- (what the system receives)

### Outputs
- (what the system produces)

### Acceptance Criteria
1. (testable criterion)
2. ...

### Constraints
- (limitations, boundaries)

### Edge Cases
- (unusual scenarios to handle)

Be precise. Eliminate all ambiguity. If the requirement is vague, make reasonable
assumptions and state them explicitly.
`;

export const captureAndClarify: Step = {
	kind: "step",
	label: "Capture and Clarify",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.3,
	description: "Transform raw requirement into a structured spec",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
