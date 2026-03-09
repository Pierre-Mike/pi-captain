// ── Step: Explore Requirements ────────────────────────────────────────────
// Stage 1 of requirements-gathering: Broad open-ended discovery to map the
// problem space, understand vision, context, goals, and stakeholders.

import { retry, user } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Explorer. Start a discovery session for this requirement.

Requirement:
$ORIGINAL

Instructions:
1. Use \`find\` and \`ls\` to understand the project structure (if a codebase exists)
2. Use \`read\` to examine README, package.json, existing code and patterns
3. Identify contextual clues about the domain, tech stack, and conventions

Then produce your discovery output in this EXACT format:

# Discovery Summary

## What We Know
(facts extracted from the request and codebase — be specific)

## Open Questions for User
Generate 5-8 open-ended questions to deeply understand intent:
1. What problem are you solving and for whom?
2. What does success look like? How will you measure it?
3. What's the broader context — existing systems, team size, timeline?
4. What inspired this request? What triggered it now?
5. What have you already tried or considered?
6. Who are the end users? What's their technical level?
7. Are there existing solutions you've looked at? What did you like/dislike?
8. What's your biggest worry or risk with this project?
(Adapt these to the specific domain — don't ask generic questions)

## Initial Hypotheses
(your best guesses for each question based on context clues)

## Knowledge Gaps
(what we absolutely need answered before proceeding — ranked by priority)
`;

export const exploreRequirements: Step = {
	kind: "step",
	label: "Explore Requirements",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.7,
	description:
		"Broad discovery with open-ended questions to understand vision, goals, and context",
	prompt,
	gate: user,
	onFail: retry,
	transform: { kind: "full" },
};
