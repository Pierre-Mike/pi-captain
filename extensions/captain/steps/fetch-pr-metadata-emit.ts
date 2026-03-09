// ── Step: Fetch PR Metadata — Emit Metadata ──────────────────────────────
// Layer 3 of github-pr-review: Metadata-emission sub-step.
// Transforms the raw GitHub API JSON from the gh-call step into a clean,
// typed PrMetadata object. Validates required fields — throws a ParseError
// if critical fields are absent.

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
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
`;

export const fetchPrMetadataEmit: Step = {
	kind: "step",
	label: "Fetch PR Metadata — Emit Metadata",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Map raw GitHub API JSON to a typed PrMetadata object — validate required fields, throw ParseError on missing data",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
