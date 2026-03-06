// ── Step: Fetch PR Metadata — Auth Check ─────────────────────────────────
// Layer 1 of github-pr-review: Authentication-check sub-step.
// Before any GitHub API call is attempted, verifies a valid GitHub token
// is present in the environment. Returns the token for use by the API-call,
// retry-loop, and auth-failure-path steps downstream.
// Depends on: parsePrInput (parse-pr-input step).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const fetchPrMetadataAuthCheck: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Check",
	agent: "builder",
	description:
		"Read GITHUB_TOKEN from the environment and throw a typed AuthError if absent or empty — returns token for downstream steps",
	prompt:
		"Using the PR reference object produced by `parsePrInput` from the previous step, implement the `fetchPrMetadataAuthCheck` step that:\n" +
		"1. Reads the GitHub token from the environment (env var: GITHUB_TOKEN)\n" +
		"2. Throws an AuthError with a clear message if the token is absent or empty:\n" +
		"   - AuthError class must extend Error with name 'AuthError'\n" +
		"   - Message must clearly state authentication failed / token missing\n" +
		"3. Returns the token string (for use by fetchPrMetadataGhCall, retry loop, and auth-failure tests)\n\n" +
		"Requirements:\n" +
		"- Export `fetchPrMetadataAuthCheck` and the `AuthError` class from `src/fetch-pr-metadata-auth-check.ts`\n" +
		"- Full TypeScript types — no 'any', explicit return type `string`\n" +
		"- Include a smoke test in `src/fetch-pr-metadata-auth-check.test.ts` that:\n" +
		"  - Temporarily unsets GITHUB_TOKEN and asserts AuthError is thrown\n" +
		"  - Sets a fake token and asserts the token string is returned\n" +
		"- End with the exact shell command to run the tests\n\n" +
		"Downstream: UNIT-7b (gh-call), UNIT-9 (auth-failure validation), UNIT-10a (retry-loop) all depend on this token.",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
