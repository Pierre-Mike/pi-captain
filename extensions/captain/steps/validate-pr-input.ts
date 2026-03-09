// ── Step: Validate PR Input ───────────────────────────────────────────────
// Layer 1 of github-pr-review: Input-validation test suite (5 rejection paths).
// Verifies parsePrInput correctly rejects: single-segment strings, non-numeric
// PR numbers, zero PR numbers, two-part strings missing the '#', and empty strings.

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
Using the \`parsePrInput\` implementation from the previous step, run the following
5 rejection-path tests. Each test must assert the function throws — never silently
returns a value.

## TEST-1 · Single-Segment Rejection
Input: 'owner' (no slash, no '#')
Assert: parsePrInput throws an error with a message containing 'Invalid PR input' or equivalent.
FAIL condition: function returns any value instead of throwing.

## TEST-2 · Non-Numeric PR Number Rejection
Input: 'owner/repo#abc'
Assert: parsePrInput throws an error indicating a non-numeric PR number.
NaN must never be silently returned.
FAIL condition: function returns { prNumber: NaN } or any object.

## TEST-3 · Zero PR Number Rejection
Input: 'owner/repo#0'
Assert: parsePrInput throws an error indicating the PR number must be greater than zero.
FAIL condition: function returns { prNumber: 0 }.

## TEST-4 · Two-Part Missing '#' Rejection
Input: 'owner/repo' (slash present, no '#')
Assert: parsePrInput throws a descriptive error. NaN for PR number is not acceptable.
FAIL condition: function returns any value with prNumber of NaN or undefined.

## TEST-5 · Empty String Rejection
Input: '' (empty string)
Assert: parsePrInput throws an appropriate error.
FAIL condition: function returns any value instead of throwing.

For each test report:
### TEST-N: [name]
- Result: PASS / FAIL
- Error thrown: [exact error message and type, or 'no error thrown']

End with:
TESTS PASSED: X / 5
ALL VALIDATED: YES / NO
`;

export const validatePrInput: Step = {
	kind: "step",
	label: "Validate PR Input",
	tools: ["read"],
	model: "flash",
	temperature: 0,
	description:
		"Run all 5 rejection-path tests for parsePrInput: single-segment, non-numeric PR, zero PR, missing '#', and empty string",
	prompt,
	onFail: retry,
	transform: full,
};
