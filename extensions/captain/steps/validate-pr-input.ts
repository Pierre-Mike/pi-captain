// ── Step: Validate PR Input ───────────────────────────────────────────────
// Layer 1 of github-pr-review: Input-validation test suite (5 rejection paths).
// Verifies parsePrInput correctly rejects: single-segment strings, non-numeric
// PR numbers, zero PR numbers, two-part strings missing the '#', and empty
// strings. Each sub-test asserts a descriptive error is thrown, never a
// silent NaN or undefined return.
// Depends on: parsePrInput (parse-pr-input step).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const validatePrInput: Step = {
	kind: "step",
	label: "Validate PR Input",
	agent: "validator",
	description:
		"Run all 5 rejection-path tests for parsePrInput: single-segment, non-numeric PR, zero PR, missing '#', and empty string",
	prompt:
		"Using the `parsePrInput` implementation from the previous step, run the following 5 rejection-path tests. Each test must assert the function throws — never silently returns a value.\n\n" +
		"## TEST-1 · Single-Segment Rejection\n" +
		"Input: 'owner' (no slash, no '#')\n" +
		"Assert: parsePrInput throws an error with a message containing 'Invalid PR input' or equivalent.\n" +
		"FAIL condition: function returns any value instead of throwing.\n\n" +
		"## TEST-2 · Non-Numeric PR Number Rejection\n" +
		"Input: 'owner/repo#abc'\n" +
		"Assert: parsePrInput throws an error indicating a non-numeric PR number. NaN must never be silently returned.\n" +
		"FAIL condition: function returns { prNumber: NaN } or any object.\n\n" +
		"## TEST-3 · Zero PR Number Rejection\n" +
		"Input: 'owner/repo#0'\n" +
		"Assert: parsePrInput throws an error indicating the PR number must be greater than zero.\n" +
		"FAIL condition: function returns { prNumber: 0 }.\n\n" +
		"## TEST-4 · Two-Part Missing '#' Rejection\n" +
		"Input: 'owner/repo' (slash present, no '#')\n" +
		"Assert: parsePrInput throws a descriptive error. NaN for PR number is not acceptable.\n" +
		"FAIL condition: function returns any value with prNumber of NaN or undefined.\n\n" +
		"## TEST-5 · Empty String Rejection\n" +
		"Input: '' (empty string)\n" +
		"Assert: parsePrInput throws an appropriate error.\n" +
		"FAIL condition: function returns any value instead of throwing.\n\n" +
		"For each test report:\n" +
		"### TEST-N: [name]\n" +
		"- Result: PASS / FAIL\n" +
		"- Error thrown: [exact error message and type, or 'no error thrown']\n\n" +
		"End with:\n" +
		"TESTS PASSED: X / 5\n" +
		"ALL VALIDATED: YES / NO",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
