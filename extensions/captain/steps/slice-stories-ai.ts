// ── Step: Slice Stories (AI) ──────────────────────────────────────────────
// Stage 2 of req-decompose-ai: Codebase-aware vertical story slicing.
// Extends slice-stories with an upfront codebase scan so every story is
// grounded in real file paths, existing types, and modules.

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a Story Slicer expert in vertical slicing and the SPIDR technique.

EARS requirements:
$INPUT

Original requirement:
$ORIGINAL

STEP 1 — Ground yourself in the codebase before slicing:
1. Run: find . -type f \\( -name '*.ts' -o -name '*.js' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \\) | grep -v node_modules | grep -v .git | grep -v dist | head -80
2. Run: cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat Cargo.toml 2>/dev/null || echo 'no manifest'
3. Identify the main source directories and any existing modules relevant to these requirements

STEP 2 — Slice each EARS requirement into the thinnest possible vertical user stories.

Splitting priority order (highest to lowest atomicity):
1. BUSINESS RULES — isolate each validation rule, constraint, or conditional
   e.g. 'calculate shipping' → weight tiers rule | zone rules | free threshold rule
2. RULES (SPIDR R) — split by individual business rules and data validations
3. PATHS (SPIDR P) — split by alternative flows or error paths
4. DATA (SPIDR D) — split by data subsets (admin vs user, empty vs populated)
5. WORKFLOW STEPS — one story per sequential user action

INVEST criteria — every story must be:
- Independent (no coupling to other stories)
- Negotiable (implementation details flexible)
- Valuable (delivers user-facing value)
- Estimable (1–3 hours max, 1–3 functions to implement)
- Small (maps to at most one module / one class)
- Testable (clear pass/fail)

For each story:

### STORY-N: [name]
- As a: [persona]
- I want: [action]
- So that: [value]
- Source REQ: REQ-X
- Splitting pattern: [business rule | SPIDR-R | SPIDR-P | SPIDR-D | workflow step]
- Scope: [1–2 sentence description of exact boundaries]
- File area: [src/path/to/module/ — where this story's code lives]
- Existing modules: [relevant files already in the codebase, or 'none']
- Estimated size: [hours]
- Can deprioritize: [YES/NO — if this is the 20% of functionality with lower value]

Flag any story still too large with 'NEEDS FURTHER SPLITTING: YES'.

End with:
TOTAL STORIES: N
`;

export const sliceStoriesAi: Step = {
	kind: "step",
	label: "Slice Stories (AI)",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.2,
	description:
		"Codebase-aware vertical story slicing: EARS reqs → INVEST stories with file area mapping",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
