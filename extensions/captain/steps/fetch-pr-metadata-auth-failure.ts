// ── Step: Fetch PR Metadata — Auth Failure Path ──────────────────────────
// Layer 2 of github-pr-review: Validates the authentication-failure path.
// Asserts that a missing or empty GITHUB_TOKEN produces a clear AuthError
// before any GitHub API call is attempted — no silent fallthrough to an
// HTTP 401, no generic error type.
// Depends on: fetchPrMetadataAuthCheck (auth-check step).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const fetchPrMetadataAuthFailure: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Failure Path",
	agent: "validator",
	description:
		"Assert that missing/empty GITHUB_TOKEN throws AuthError before any API call is made — no generic HTTP error, no silent fallthrough",
	prompt:
		"Using `fetchPrMetadataAuthCheck` from the auth-check step, write and run a test that simulates a missing or empty GITHUB_TOKEN environment variable and asserts:\n\n" +
		"1. An AuthError (or equivalent typed error) is thrown\n" +
		"2. The error message clearly states authentication failed / token missing\n" +
		"3. No GitHub API call is attempted when the token is absent — verify with a spy/mock\n\n" +
		"Test cases to cover:\n" +
		"- CASE A: GITHUB_TOKEN is completely unset (delete from process.env)\n" +
		"- CASE B: GITHUB_TOKEN is set to an empty string ''\n" +
		"- CASE C: GITHUB_TOKEN is set to a whitespace-only string '   ' (if your implementation trims)\n\n" +
		"For each case report:\n" +
		"### CASE [A/B/C]: [description]\n" +
		"- Result: PASS / FAIL\n" +
		"- Error type thrown: [class name, e.g. AuthError]\n" +
		"- Error message: [exact message]\n" +
		"- API call attempted: YES / NO\n\n" +
		"End with:\n" +
		"CASES PASSED: X / 3\n" +
		"AUTH FAILURE PATH VALIDATED: YES / NO",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
