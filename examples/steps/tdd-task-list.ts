// ── Step: TDD Task List ───────────────────────────────────────────────────
// Stage 4 of req-decompose: Apply Kent Beck's Canon TDD task list technique
// to each BDD scenario. Expand each scenario into a list of unit-level test
// scenarios → each maps to 1 failing test → 1 function → 1 commit.

import { retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are a TDD practitioner applying Kent Beck's Canon TDD task list technique.

BDD scenarios:
$INPUT

For each BDD scenario, produce a TDD task list:
- Write ALL test scenarios you can think of for this behaviour (one line each)
- Order them: simplest / degenerate case first, then progressively more complex
- Each item = exactly 1 unit test + 1 function/code change + 1 commit
- Estimated implementation time per item: 5–15 minutes
- If an item would take longer → split it further

For each BDD scenario:

### STORY-N, SCENARIO N.X: [scenario name]
[Acceptance test: Given/When/Then from input]

**TDD Task List:**
- [ ] TASK-N.X.1: [test name] → fn: [function name to implement]
  - Test: [one-line description of what the unit test asserts]
  - Implementation: [one-line description of the code to write]
  - Est: [minutes]
- [ ] TASK-N.X.2: ...
(newly discovered tasks found while thinking are added at end with *)

Atomicity rules per task:
- Single responsibility: tests exactly ONE behaviour
- Single function: implements or modifies exactly ONE function
- No setup beyond the function under test
- A junior dev should be able to complete it in one sitting without interruption

End with:
TOTAL TASKS: N
ALL ATOMIC: YES / NO (if NO, flag which tasks need further splitting)
`;

export const tddTaskList: Step = {
	kind: "step",
	label: "TDD Task List",
	tools: ["read", "bash"],
	model: "sonnet",
	description:
		"Apply Kent Beck's Canon TDD task list: each BDD scenario → atomic unit tests → 1 function each",
	prompt,
	onFail: retry(),
	transform: full,
};
