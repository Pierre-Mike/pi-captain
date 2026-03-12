// ── Step: Synthesize PR Verdict ───────────────────────────────────────────
// Layer 6 of github-pr-review: Aggregate all per-file review findings into
// a final verdict (APPROVE / REQUEST_CHANGES / COMMENT), produce a structured
// review summary, then post the full review to GitHub via the CLI.

import { retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the PR review synthesizer.
All per-file review findings:$INPUT
Original PR:$ORIGINAL
STEP 1 — Tally findings across all files:
- Count by severity: CRITICAL / HIGH / MEDIUM / LOW / INFO
- Identify the top 3 most impactful issues
- Identify anything blocking merge
STEP 2 — Determine verdict:
- APPROVE: zero CRITICAL/HIGH, LOW/INFO only
- REQUEST_CHANGES: any CRITICAL or HIGH finding
- COMMENT: MEDIUM findings only, no blockers
STEP 3 — Write the review body (markdown, GitHub-flavored):
## PR Review Summary
**Verdict:** [APPROVE|REQUEST_CHANGES|COMMENT]
### Overview
[2-3 sentence summary of what the PR does and overall quality]
### Critical Issues
[list blocking issues, or 'None']
### Suggestions
[list non-blocking improvements]
### Positive Notes
[what was done well]
STEP 4 — Post the review to GitHub using the CLI:
Run: gh pr review {prNumber} --repo {owner}/{repo}
  --[approve|request-changes|comment]
  --body '[review body from Step 3]'
Extract the PR number and repo from $ORIGINAL or metadata in $INPUT.
Report the CLI command run and its output.
End with:
VERDICT: [APPROVE|REQUEST_CHANGES|COMMENT]
CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N
REVIEW POSTED: YES / NO
`;

export const synthesizePrVerdict: Step = {
	kind: "step",
	label: "Synthesize PR Verdict",
	tools: ["read", "bash"],
	model: "flash",
	description: `Aggregate all file findings → final verdict + reasoning, then post review to GitHub via CLI`,
	prompt,
	onFail: retry(),
	transform: full,
};
