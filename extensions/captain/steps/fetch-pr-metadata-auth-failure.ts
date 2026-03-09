// ── Step: Fetch PR Metadata — Auth Failure Path ──────────────────────────
// Layer 2 of github-pr-review: Validates the authentication-failure path.
// Asserts that a missing or empty GITHUB_TOKEN produces a clear AuthError
// before any GitHub API call is attempted — no silent fallthrough to an
// HTTP 401, no generic error type.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
Using \`fetchPrMetadataAuthCheck\` from the auth-check step, write and run a test that
simulates a missing or empty GITHUB_TOKEN environment variable and asserts:

1. An AuthError (or equivalent typed error) is thrown
2. The error message clearly states authentication failed / token missing
3. No GitHub API call is attempted when the token is absent — verify with a spy/mock

Test cases to cover:
- CASE A: GITHUB_TOKEN is completely unset (delete from process.env)
- CASE B: GITHUB_TOKEN is set to an empty string ''
- CASE C: GITHUB_TOKEN is set to a whitespace-only string '   ' (if your implementation trims)

For each case report:
### CASE [A/B/C]: [description]
- Result: PASS / FAIL
- Error type thrown: [class name, e.g. AuthError]
- Error message: [exact message]
- API call attempted: YES / NO

End with:
CASES PASSED: X / 3
AUTH FAILURE PATH VALIDATED: YES / NO
`;

export const fetchPrMetadataAuthFailure: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Failure Path",
	tools: ["read"],
	model: "flash",
	temperature: 0,
	description:
		"Assert that missing/empty GITHUB_TOKEN throws AuthError before any API call is made",
	prompt,
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
