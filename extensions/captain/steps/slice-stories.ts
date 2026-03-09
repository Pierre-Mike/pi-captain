// ── Step: Slice Stories ──────────────────────────────────────────────────
// Stage 2 of req-decompose: Vertically slice EARS requirements into thin,
// independently shippable user stories using business rule splitting and
// SPIDR patterns. Each story cuts through all layers (no horizontal slices).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a Story Slicer expert in vertical slicing and the SPIDR technique.

EARS requirements:
$INPUT

Original requirement:
$ORIGINAL

Slice each EARS requirement into the thinnest possible vertical user stories.

Splitting priority order (highest to lowest atomicity):
1. BUSINESS RULES — isolate each validation rule, constraint, or conditional into its own story
   e.g. 'calculate shipping' → weight tiers rule | zone rules | free threshold rule
2. RULES (SPIDR R) — split by individual business rules and data validations
3. PATHS (SPIDR P) — split by alternative user flows or error paths
4. DATA (SPIDR D) — split by data subsets (e.g. admin vs. user, empty vs. populated)
5. WORKFLOW STEPS — one story per sequential user action

INVEST criteria — every story must be:
- Independent (no coupling to other stories)
- Negotiable (implementation details flexible)
- Valuable (delivers user-facing value)
- Estimable (1–3 hours max)
- Small (1–3 functions to implement)
- Testable (clear pass/fail)

For each story:

### STORY-N: [name]
- As a: [persona]
- I want: [action]
- So that: [value]
- Source REQ: REQ-X
- Splitting pattern: [business rule | SPIDR-R | SPIDR-P | SPIDR-D | workflow step]
- Scope: [1–2 sentence description of exact boundaries]
- Estimated size: [hours]
- Can deprioritize: [YES/NO — if this is the 20% of functionality with lower value]

Flag any story still too large with 'NEEDS FURTHER SPLITTING: YES'.

End with:
TOTAL STORIES: N
`;

export const sliceStories: Step = {
	kind: "step",
	label: "Slice Stories",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.2,
	description:
		"Vertically slice EARS requirements into thin user stories using business rules + SPIDR",
	prompt,
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
