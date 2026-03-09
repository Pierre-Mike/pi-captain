// ── Step: Fetch PR Metadata — Auth Check ─────────────────────────────────
// Layer 1 of github-pr-review: Authentication-check sub-step.
// Before any GitHub API call is attempted, verifies a valid GitHub token
// is present in the environment. Returns the token for use by the API-call,
// retry-loop, and auth-failure-path steps downstream.

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
Using the PR reference object produced by \`parsePrInput\` from the previous step,
implement the \`fetchPrMetadataAuthCheck\` step that:

1. Reads the GitHub token from the environment (env var: GITHUB_TOKEN)
2. Throws an AuthError with a clear message if the token is absent or empty:
   - AuthError class must extend Error with name 'AuthError'
   - Message must clearly state authentication failed / token missing
3. Returns the token string (for use by fetchPrMetadataGhCall, retry loop, and auth-failure tests)

Requirements:
- Export \`fetchPrMetadataAuthCheck\` and the \`AuthError\` class from \`src/fetch-pr-metadata-auth-check.ts\`
- Full TypeScript types — no 'any', explicit return type \`string\`
- Include a smoke test in \`src/fetch-pr-metadata-auth-check.test.ts\` that:
  - Temporarily unsets GITHUB_TOKEN and asserts AuthError is thrown
  - Sets a fake token and asserts the token string is returned
- End with the exact shell command to run the tests

Downstream: UNIT-7b (gh-call), UNIT-9 (auth-failure validation), UNIT-10a (retry-loop)
all depend on this token.
`;

export const fetchPrMetadataAuthCheck: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Check",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Read GITHUB_TOKEN from the environment and throw a typed AuthError if absent or empty",
	prompt,
	onFail: retry,
	transform: full,
};
