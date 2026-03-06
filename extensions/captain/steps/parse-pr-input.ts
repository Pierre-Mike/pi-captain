// ── Step: Parse PR Input ──────────────────────────────────────────────────
// Layer 0 of github-pr-review: Universal root unit.
// Parses a canonical 'owner/repo#number' string into a structured PR
// reference object. All 14 downstream units depend on this output.
// Resolves 4 systemic contract gaps: correct TypeScript types, correct file
// path, self-contained test code, and a runnable test command.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const parsePrInput: Step = {
	kind: "step",
	label: "Parse PR Input",
	agent: "builder",
	description:
		"Parse canonical 'owner/repo#number' string into a typed PR reference object — universal root for all downstream units",
	prompt:
		"You are building the core GitHub PR review pipeline. Implement `parsePrInput(input: string): { owner: string; repo: string; prNumber: number }` that:\n" +
		"1. Splits on '/' to extract owner and repo+number parts\n" +
		"2. Further splits repo+number on '#' to extract repo name and PR number\n" +
		"3. Parses PR number as a base-10 integer\n" +
		"4. Returns the structured object { owner, repo, prNumber }\n" +
		"Ensure the function is exported from its module, typings are correct, the file is at the agreed path, and the test suite can be executed with a single runnable command. Fix all 4 contract gaps before marking done.\n\n" +
		"Contract gaps to resolve:\n" +
		"- TYPES: Use strict TypeScript — no 'any', explicit return type annotation\n" +
		"- FILE PATH: Write implementation to `src/parse-pr-input.ts` and test to `src/parse-pr-input.test.ts`\n" +
		"- TEST CODE: Test must be self-contained — no external fixtures, concrete values only\n" +
		"- RUNNABLE COMMAND: End your response with the exact shell command to run the tests\n\n" +
		"Validation: parsePrInput('octocat/hello-world#42') must return { owner: 'octocat', repo: 'hello-world', prNumber: 42 }",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
