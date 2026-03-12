// ── Steps: Fetch PR Metadata ──────────────────────────────────────────────
// Four sub-steps that together fetch and validate PR metadata from GitHub.
// Layered: auth-check → gh-call → emit-metadata, with auth-failure validation.

import { retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

// ── Layer 1: Auth Check ───────────────────────────────────────────────────
export const fetchPrMetadataAuthCheck: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Check",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Read GITHUB_TOKEN from the environment and throw a typed AuthError if absent or empty",
	prompt: `
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
`,
	onFail: retry(),
	transform: full,
};

// ── Layer 2a: GitHub API Call ─────────────────────────────────────────────
export const fetchPrMetadataGhCall: Step = {
	kind: "step",
	label: "Fetch PR Metadata — GitHub API Call",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Call GET /repos/{owner}/{repo}/pulls/{prNumber} with Bearer token — return raw PR JSON or throw typed HttpError",
	prompt: `
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
`,
	onFail: retry(),
	transform: full,
};

// ── Layer 2b: Auth Failure Path ───────────────────────────────────────────
export const fetchPrMetadataAuthFailure: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Auth Failure Path",
	tools: ["read"],
	model: "flash",
	description:
		"Assert that missing/empty GITHUB_TOKEN throws AuthError before any API call is made",
	prompt: `
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
`,
	onFail: retry(),
	transform: full,
};

// ── Layer 3: Emit Metadata ────────────────────────────────────────────────
export const fetchPrMetadataEmit: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Emit Metadata",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Map raw GitHub API JSON to a typed PrMetadata object — validate required fields, throw ParseError on missing data",
	prompt: `
Using the raw JSON returned by \`fetchPrMetadataGhCall\`, implement \`fetchPrMetadataEmitMetadata\` that:

1. Maps the GitHub API response fields to a typed \`PrMetadata\` interface:
   \`\`\`typescript
   interface PrMetadata {
     title: string;
     body: string | null;
     author: string;
     baseBranch: string;
     headBranch: string;
     changedFiles: number;
     additions: number;
     deletions: number;
     state: 'open' | 'closed' | 'merged';
   }
   \`\`\`
   Field mapping:
   - title → title
   - body → body
   - user.login → author
   - base.ref → baseBranch
   - head.ref → headBranch
   - changed_files → changedFiles
   - additions → additions
   - deletions → deletions
   - state → state

2. Validates required fields are present (title, author, baseBranch, headBranch, state):
   - Throws a ParseError with message 'Missing required field: {fieldName}' if any are absent
   - ParseError class extends Error with name 'ParseError'

3. Returns the typed PrMetadata object on success

Requirements:
- Export \`fetchPrMetadataEmitMetadata\`, \`PrMetadata\` interface, and \`ParseError\`
  from \`src/fetch-pr-metadata-emit.ts\`
- Full TypeScript types — no 'any'
- Write a unit test in \`src/fetch-pr-metadata-emit.test.ts\` with a fixture response:
  - Happy path: full fixture → correct PrMetadata returned
  - Missing title: ParseError thrown with correct field name
- End with the exact shell command to run the tests

Downstream: UNIT-8 (not-found check) and UNIT-12 (empty-body check) both test this function.
`,
	onFail: retry(),
	transform: full,
};
