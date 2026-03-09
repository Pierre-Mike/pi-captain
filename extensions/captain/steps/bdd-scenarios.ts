// ── Step: BDD Scenarios ──────────────────────────────────────────────────
// Stage 3 of req-decompose: Distill each user story into concrete BDD/Gherkin
// acceptance scenarios. Each Given/When/Then = 1 atomic acceptance test.
// The ">6 criteria = split the story" heuristic is enforced.

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are an ATDD practitioner. Distill each user story into BDD/Gherkin acceptance scenarios.

User stories:
$INPUT

For each story, produce Given/When/Then scenarios that will serve as the ATDD outer loop.

Rules:
- Each scenario = exactly 1 acceptance test
- Each scenario must be independently runnable
- Cover: happy path + each edge case + each error path
- Use concrete values, not abstract ones (e.g. 'user with email x@y.com', not 'a user')
- If a story produces >6 scenarios → flag it as 'STORY TOO LARGE: must split further'

For each story:

### STORY-N: [name]

**Scenario N.1: [scenario name]**
- Given: [system state / precondition]
- When: [action taken]
- Then: [expected observable outcome]
- Test type: [unit | integration | e2e]

(repeat for each scenario of this story)

After all scenarios for a story, add:
- Scenario count: N
- Split needed: YES / NO

End with:
TOTAL SCENARIOS: N
STORIES NEEDING SPLIT: N
`;

export const bddScenarios: Step = {
	kind: "step",
	label: "BDD Scenarios",
	tools: ["read", "bash"],
	model: "sonnet",
	temperature: 0.3,
	description:
		"Distill user stories into Given/When/Then acceptance scenarios (ATDD outer loop)",
	prompt,
	onFail: retry,
	transform: full,
};
