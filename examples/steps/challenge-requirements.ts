// ── Step: Challenge Requirements ──────────────────────────────────────────
// Stage 3 of requirements-gathering: Devil's advocate phase — stress-test
// all gathered information for contradictions, unstated assumptions, missing
// perspectives, and completeness.

import { retry, user } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the Challenger. Review ALL gathered information and play devil's advocate.

Original requirement:
$ORIGINAL

All gathered information (exploration + deep-dive + user answers):
$INPUT

Instructions:
1. Read through every answer carefully — look for contradictions
2. If a codebase exists, verify claims against actual code
3. Think about stakeholders/scenarios nobody mentioned

Produce your challenge report in this EXACT format:

# Challenge Report

## Contradictions Found
(list any conflicting statements or requirements — or 'None found')

## Unstated Assumptions
(what we're assuming that hasn't been explicitly confirmed)

## Missing Perspectives
(stakeholders, user types, or scenarios not yet considered)

## Completeness Checklist
- [ ] User personas defined?
- [ ] Happy path clear?
- [ ] Error/edge cases covered?
- [ ] Performance expectations set?
- [ ] Security considerations addressed?
- [ ] Data requirements clear?
- [ ] Integration points mapped?
- [ ] Success metrics defined?
- [ ] Migration/rollback plan needed?
- [ ] Accessibility requirements considered?
(Mark [x] for covered, [ ] for gaps, add notes)

## Final Confirmation Questions
Generate 3-5 CLOSED questions to resolve the most critical remaining uncertainties:
1. (question) — Yes/No
2. (question) — A/B/C
3. (question) — Yes/No

## Confidence Assessment
(How confident are we that requirements will be accurate? Why? What's the biggest remaining risk?)
`;

export const challengeRequirements: Step = {
	kind: "step",
	label: "Challenge & Validate",
	tools: ["read", "bash"],
	model: "sonnet",
	description:
		"Stress-test assumptions, find contradictions, and close remaining gaps",
	prompt,
	gate: user,
	onFail: retry(1),
	transform: full,
};
