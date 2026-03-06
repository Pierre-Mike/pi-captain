// ── Step: Fetch PR Changed Files ─────────────────────────────────────────
// Layer 4 of github-pr-review: Fetch the full list of changed files and
// their diffs from the GitHub REST API, then emit a structured file list
// with per-file stats (additions, deletions, patch content).

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const fetchPrFiles: Step = {
	kind: "step",
	label: "Fetch PR Changed Files",
	agent: "builder",
	description:
		"Fetch all changed files and diffs via GitHub CLI — emit structured file list for parallel review",
	prompt:
		"You have PR metadata from the previous step.\n\n" +
		"Fetch all changed files for the PR using the GitHub CLI:\n\n" +
		"1. Run: gh pr view {prNumber} --repo {owner}/{repo} --json files 2>/dev/null\n" +
		"   If that fails, run: gh pr diff {prNumber} --repo {owner}/{repo} 2>/dev/null\n" +
		"2. Parse the output into a structured list of changed files\n\n" +
		"For each changed file emit:\n\n" +
		"### FILE-N: [path]\n" +
		"- Status: [added|modified|removed|renamed]\n" +
		"- Additions: N\n" +
		"- Deletions: N\n" +
		"- Language: [typescript|javascript|python|go|rust|other]\n" +
		"- Diff (first 200 lines):\n" +
		"  ```diff\n" +
		"  [diff content]\n" +
		"  ```\n\n" +
		"End with:\n" +
		"TOTAL FILES: N\n" +
		"TOTAL ADDITIONS: N\n" +
		"TOTAL DELETIONS: N",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
