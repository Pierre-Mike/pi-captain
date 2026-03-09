// ── Step: Fetch PR Metadata — GitHub API Call ─────────────────────────────
// Layer 2 of github-pr-review: GitHub REST API invocation sub-step.
// Uses the validated token from the auth-check step to call
// GET /repos/{owner}/{repo}/pulls/{prNumber} and return raw PR JSON.
// Throws a typed HttpError (with status code) on non-2xx responses.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
Using the token returned by \`fetchPrMetadataAuthCheck\` and the PR reference from \`parsePrInput\`,
implement \`fetchPrMetadataGhCall\` that:

1. Calls \`GET /repos/{owner}/{repo}/pulls/{prNumber}\` on the GitHub REST API
   (base URL: https://api.github.com)
2. Passes the token as a Bearer Authorization header: \`Authorization: Bearer <token>\`
3. Sets \`Accept: application/vnd.github+json\` and \`X-GitHub-Api-Version: 2022-11-28\` headers
4. Returns the raw response body as a parsed JSON object on 2xx responses
5. Throws a typed HttpError on non-2xx HTTP status codes:
   - HttpError class extends Error with \`statusCode: number\` property
   - Preserve the exact HTTP status code on the error instance
   - Message format: \`GitHub API error {statusCode}: {statusText}\`

Requirements:
- Export \`fetchPrMetadataGhCall\` and \`HttpError\` from \`src/fetch-pr-metadata-gh-call.ts\`
- Accept a mock-able HTTP client as a dependency-injected parameter for testability
- Full TypeScript types — no 'any'; return type is \`Promise<unknown>\` (raw JSON)
- Write a unit test in \`src/fetch-pr-metadata-gh-call.test.ts\` using a mock HTTP client
  that verifies:
  - Correct URL construction: https://api.github.com/repos/{owner}/{repo}/pulls/{prNumber}
  - Authorization header is injected with the provided token
  - HttpError is thrown with correct status code on a 404 mock response
- End with the exact shell command to run the tests
`;

export const fetchPrMetadataGhCall: Step = {
	kind: "step",
	label: "Fetch PR Metadata — GitHub API Call",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Call GET /repos/{owner}/{repo}/pulls/{prNumber} with Bearer token — return raw PR JSON or throw typed HttpError",
	prompt,
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
