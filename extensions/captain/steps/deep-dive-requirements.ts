// ── Step: Deep Dive Requirements ──────────────────────────────────────────
// Stage 2 of requirements-gathering: Targeted mix of closed (yes/no, pick-one)
// and open questions to eliminate ambiguity, lock down constraints, and
// uncover edge cases.

import { retry, user } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are the Deep Diver. Take the exploration findings and the user's answers, then drill deeper.

Original requirement:
$ORIGINAL

Exploration findings + user answers:
$INPUT

Instructions:
1. Analyze what the user revealed — look for implied needs they didn't state explicitly
2. If a codebase exists, cross-reference answers with actual code to spot gaps

Produce your deep-dive output in this EXACT format:

# Deep Dive Report

## Confirmed Understanding
(what we now know for certain — bullet points)

## Closed Questions (pick-one / yes-no)
Generate 4-6 closed questions to lock down specifics:
1. [SCOPE] Is X in scope or out of scope? (In / Out)
2. [PRIORITY] Which matters more: A or B?
3. [CONSTRAINT] Must this work with/without X? (Yes / No)
4. [ACCEPTANCE] Is [specific threshold] acceptable? (Yes / No)
5. [TIMELINE] Is this needed by [date] or is it flexible? (Fixed / Flexible)
6. [TRADE-OFF] Would you accept [trade-off A] to get [benefit B]? (Yes / No)
(For each: explain WHY you're asking — what requirement it locks down)

## Targeted Open Questions
Generate 3-4 open questions to explore revealed complexity:
1. [EDGE CASE] What should happen when...?
2. [INTEGRATION] How does this connect to...?
3. [WORKFLOW] Walk me through the step-by-step flow of...
4. [DOMAIN] Can you explain what [domain term] means in your context?
(For each: explain WHY you're asking)

## Emerging Requirements
(requirements starting to crystallize — numbered FR-001, FR-002...)

## Risk Flags
(potential issues, complexity, or ambiguity spotted)
`;

export const deepDiveRequirements: Step = {
	kind: "step",
	label: "Deep Dive Requirements",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.5,
	description:
		"Targeted closed and open questions to eliminate ambiguity and lock down specifics",
	prompt,
	gate: user,
	onFail: retry(),
	transform: full,
};
