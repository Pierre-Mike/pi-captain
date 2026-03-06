// ── Step: Synthesize PR Verdict ───────────────────────────────────────────
// Layer 6 of github-pr-review: Aggregate all per-file review findings into
// a final verdict (APPROVE / REQUEST_CHANGES / COMMENT), produce a structured
// review summary, then post the full review to GitHub via the CLI.

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const synthesizePrVerdict: Step = {
	kind: "step",
	label: "Synthesize PR Verdict",
	agent: "resolver",
	description:
		"Aggregate all file findings → final verdict + reasoning, then post review to GitHub via CLI",
	prompt:
		"You are the PR review synthesizer.\n\n" +
		"All per-file review findings:\n$INPUT\n\n" +
		"Original PR:\n$ORIGINAL\n\n" +
		"STEP 1 — Tally findings across all files:\n" +
		"- Count by severity: CRITICAL / HIGH / MEDIUM / LOW / INFO\n" +
		"- Identify the top 3 most impactful issues\n" +
		"- Identify anything blocking merge\n\n" +
		"STEP 2 — Determine verdict:\n" +
		"- APPROVE: zero CRITICAL/HIGH, LOW/INFO only\n" +
		"- REQUEST_CHANGES: any CRITICAL or HIGH finding\n" +
		"- COMMENT: MEDIUM findings only, no blockers\n\n" +
		"STEP 3 — Write the review body (markdown, GitHub-flavored):\n" +
		"## PR Review Summary\n" +
		"**Verdict:** [APPROVE|REQUEST_CHANGES|COMMENT]\n\n" +
		"### Overview\n" +
		"[2-3 sentence summary of what the PR does and overall quality]\n\n" +
		"### Critical Issues\n" +
		"[list blocking issues, or 'None']\n\n" +
		"### Suggestions\n" +
		"[list non-blocking improvements]\n\n" +
		"### Positive Notes\n" +
		"[what was done well]\n\n" +
		"STEP 4 — Post the review to GitHub using the CLI:\n" +
		"Run: gh pr review {prNumber} --repo {owner}/{repo} \\\n" +
		"  --[approve|request-changes|comment] \\\n" +
		"  --body '[review body from Step 3]'\n\n" +
		"Extract the PR number and repo from $ORIGINAL or metadata in $INPUT.\n\n" +
		"Report the CLI command run and its output.\n\n" +
		"End with:\n" +
		"VERDICT: [APPROVE|REQUEST_CHANGES|COMMENT]\n" +
		"CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N\n" +
		"REVIEW POSTED: YES / NO",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
