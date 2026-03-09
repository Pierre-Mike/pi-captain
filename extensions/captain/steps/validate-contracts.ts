// ── Step: Validate Contracts ─────────────────────────────────────────────
// Stage 6 of req-decompose-ai: Machine-verifiability gate.
// Checks every UNIT-N contract against four hard criteria:
//   1. Typed signature — no 'any', no vague param names, return type explicit
//   2. Explicit file path — exact path, not "somewhere in src"
//   3. Pre-written test — runnable code, not "write a test that..."
//   4. Runnable verification — a real shell command, not a description

import { fallback, regexCI } from "../gates/index.js";
import type { Step } from "../types.js";
import { contractTasks } from "./contract-tasks.js";

// Targeted fallback: re-contract only the units that failed validation
const reContract: typeof contractTasks = {
	...contractTasks,
	label: "Re-Contract Failing Units",
	description:
		"Re-generate contracts for units that failed machine-verifiability",
	prompt: `
Some UNIT contracts failed machine-verifiability validation.
Re-generate ONLY the failing units.

Full contract list (failing units identified below):
$INPUT

Original requirement:
$ORIGINAL

For each FAIL unit:
1. Re-read the relevant source files to get accurate types
2. Re-generate the contract with ALL four criteria satisfied:
   - Typed signature (no 'any', explicit return type)
   - Explicit file path (exact path that exists or will be created)
   - Pre-written test (copy-pasteable, concrete values, runnable now)
   - Verification command (exact shell command)

Keep all PASS units unchanged. Output the complete merged unit list.

End with:
TOTAL UNITS: N
ALL CONTRACTS VALID: YES
`,
};

const prompt = `
You are the Contract Validator. Check every UNIT contract against four hard criteria.

Contracts:
$INPUT

For each UNIT, check all four criteria:

1. TYPED SIGNATURE — does \`Function:\` have concrete input types and return type?
   (no 'any', no 'object')
2. EXPLICIT FILE — does \`File:\` contain a full path to a specific file?
   (not 'src/...' or 'somewhere')
3. PRE-WRITTEN TEST — does \`Pre-written test:\` contain runnable code with concrete values?
   (not a description)
4. RUNNABLE VERIFICATION — does \`Verification:\` contain a real shell command?
   (not 'run the tests')

For each unit:
### UNIT-N: [name]
- Typed signature: PASS / FAIL — [reason if FAIL]
- Explicit file: PASS / FAIL — [reason if FAIL]
- Pre-written test: PASS / FAIL — [reason if FAIL]
- Runnable verification: PASS / FAIL — [reason if FAIL]
- Verdict: PASS (all 4) / FAIL (any failed)
- Dependencies: [pass through from input]

Then output summary:
VALIDATED: X / Y
FAILED UNITS: (comma-separated list, or "none")

If all units passed, end with exactly:
ALL CONTRACTS VALID: YES

If any failed, end with exactly:
ALL CONTRACTS VALID: NO
`;

export const validateContracts: Step = {
	kind: "step",
	label: "Validate Contracts",
	tools: ["read"],
	model: "flash",
	temperature: 0,
	description:
		"Machine-verifiability gate: typed signature + explicit file + pre-written test + runnable command",
	prompt,
	gate: regexCI("all.contracts.valid.*yes"),
	onFail: fallback(reContract),
	transform: { kind: "full" },
};
