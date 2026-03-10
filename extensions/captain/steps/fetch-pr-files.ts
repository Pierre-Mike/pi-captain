// ── Step: Fetch PR Changed Files ─────────────────────────────────────────
// Layer 4 of github-pr-review: Fetch the full list of changed files and
// their diffs from the GitHub REST API, then emit a structured file list
// with per-file stats (additions, deletions, patch content).

import { retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You have PR metadata from the previous step.

Fetch all changed files for the PR using the GitHub CLI:

1. Run: gh pr view {prNumber} --repo {owner}/{repo} --json files 2>/dev/null
   If that fails, run: gh pr diff {prNumber} --repo {owner}/{repo} 2>/dev/null
2. Parse the output into a structured list of changed files

For each changed file emit:

### FILE-N: [path]
- Status: [added|modified|removed|renamed]
- Additions: N
- Deletions: N
- Language: [typescript|javascript|python|go|rust|other]
- Diff (first 200 lines):
  \`\`\`diff
  [diff content]
  \`\`\`

End with:
TOTAL FILES: N
TOTAL ADDITIONS: N
TOTAL DELETIONS: N
`;

export const fetchPrFiles: Step = {
	kind: "step",
	label: "Fetch PR Changed Files",
	tools: ["read", "bash", "edit", "write"],
	description:
		"Fetch all changed files and diffs via GitHub CLI — emit structured file list for parallel review",
	prompt,
	onFail: retry(),
	transform: full,
};
