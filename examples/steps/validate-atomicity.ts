// ── Step: Validate Atomicity ──────────────────────────────────────────────
// Stage 5 of req-decompose: Verify every TDD task is truly atomic:
// 1 function, 1 test, 5–15 min estimate. Flag and re-split any violators.

import { fallback, regexCI } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";
import { tddTaskList } from "./tdd-task-list.js";

// Reuse tddTaskList as the fallback to re-split non-atomic tasks
const reExpandTasks: typeof tddTaskList = {
	...tddTaskList,
	label: "Re-expand Tasks",
	description: "Re-apply TDD task list to non-atomic tasks",
	prompt: `
Some TDD tasks were flagged as non-atomic. Re-expand ONLY the failing tasks into smaller items.

Full task list (failing tasks flagged below):
$INPUT

For each FAIL task, produce 2–4 smaller sub-tasks following the same format.
Keep all PASS tasks unchanged. Output the complete merged task list.

End with:
TOTAL TASKS: N
ALL ATOMIC: YES
`,
};

const prompt = `
You are the Atomicity Validator. Check every TDD task against atomicity criteria.

TDD task list:
$INPUT

For each task, answer three questions:
1. Single function? (does it touch exactly one function/method?)
2. Single test? (does it require exactly one test assertion?)
3. Time-boxed? (can a developer complete it in 5–15 minutes?)

For each task:
### TASK-N.X.Y: [name]
- Single function: YES / NO
- Single test: YES / NO
- Time-boxed (5–15 min): YES / NO
- Verdict: PASS / FAIL
- Reason: (one sentence if FAIL)

Then output summary:
VALIDATED: X / Y
FAILED TASKS: (comma-separated list, or "none")

If all tasks passed, end with exactly:
ALL ATOMIC: YES

If any failed, end with exactly:
ALL ATOMIC: NO
`;

export const validateAtomicity: Step = {
	kind: "step",
	label: "Validate Atomicity",
	tools: ["read"],
	model: "flash",
	description:
		"Verify each TDD task is truly atomic: 1 function, 1 test, 5–15 min",
	prompt,
	gate: regexCI("all.atomic.*yes"),
	onFail: fallback(reExpandTasks),
	transform: full,
};
