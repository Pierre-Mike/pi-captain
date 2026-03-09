// ── Step: Parse PR Input ──────────────────────────────────────────────────
// Stage 1 of github-pr-review: parse a canonical 'owner/repo#number' string
// into its three components so every downstream step has clean references.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You have received a PR reference string. It is in $INPUT.

The string must follow the format: owner/repo#N  (e.g. 'octocat/hello-world#42').

Parse it now:
1. Split on '/' → left side is the owner, right side is 'repo#N'
2. Split 'repo#N' on '#' → left side is the repo name, right side is the PR number
3. Confirm the PR number is a positive integer

If the format is correct, output exactly:

## PR Reference
- Owner: [owner]
- Repo: [repo]
- PR Number: [N]
- Full ref: [owner/repo#N]

If the format is wrong (missing '/', missing '#', non-numeric PR number, empty string, PR number ≤ 0),
output exactly:

ERROR: [reason]

Do not output anything else.
`;

export const parsePrInput: Step = {
	kind: "step",
	label: "Parse PR Input",
	tools: ["read", "bash", "edit", "write"],
	description: "Parse 'owner/repo#N' into owner, repo, and PR number",
	prompt,
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
