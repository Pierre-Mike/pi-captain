// ── Step: Fetch PR Metadata — Emit Metadata ──────────────────────────────
// Layer 3 of github-pr-review: Metadata-emission sub-step.
// Transforms the raw GitHub API JSON from the gh-call step into a clean,
// typed PrMetadata object. Validates required fields — throws a ParseError
// if critical fields are absent. Output feeds the not-found check and the
// empty-body edge-case validator.
// Depends on: fetchPrMetadataGhCall (gh-call step).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const fetchPrMetadataEmit: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Emit Metadata",
	agent: "builder",
	description:
		"Map raw GitHub API JSON to a typed PrMetadata object — validate required fields, throw ParseError on missing/malformed data",
	prompt:
		"Using the raw JSON returned by `fetchPrMetadataGhCall`, implement `fetchPrMetadataEmitMetadata` that:\n" +
		"1. Maps the GitHub API response fields to a typed `PrMetadata` interface:\n" +
		"   ```typescript\n" +
		"   interface PrMetadata {\n" +
		"     title: string;\n" +
		"     body: string | null;\n" +
		"     author: string;\n" +
		"     baseBranch: string;\n" +
		"     headBranch: string;\n" +
		"     changedFiles: number;\n" +
		"     additions: number;\n" +
		"     deletions: number;\n" +
		"     state: 'open' | 'closed' | 'merged';\n" +
		"   }\n" +
		"   ```\n" +
		"   Field mapping: title→title, body→body, user.login→author, base.ref→baseBranch, head.ref→headBranch,\n" +
		"   changed_files→changedFiles, additions→additions, deletions→deletions, state→state\n" +
		"2. Validates required fields are present (title, author, baseBranch, headBranch, state):\n" +
		"   - Throws a ParseError with message 'Missing required field: {fieldName}' if any are absent\n" +
		"   - ParseError class extends Error with name 'ParseError'\n" +
		"3. Returns the typed PrMetadata object on success\n\n" +
		"Requirements:\n" +
		"- Export `fetchPrMetadataEmitMetadata`, `PrMetadata` interface, and `ParseError` from `src/fetch-pr-metadata-emit.ts`\n" +
		"- Full TypeScript types — no 'any'\n" +
		"- Write a unit test in `src/fetch-pr-metadata-emit.test.ts` with a fixture response:\n" +
		"  - Happy path: full fixture → correct PrMetadata returned\n" +
		"  - Missing title: ParseError thrown with correct field name\n" +
		"- End with the exact shell command to run the tests\n\n" +
		"Downstream: UNIT-8 (not-found check) and UNIT-12 (empty-body check) both test this function.",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
