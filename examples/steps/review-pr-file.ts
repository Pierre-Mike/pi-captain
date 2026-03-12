// ── Step: Review PR File ──────────────────────────────────────────────────
// Layer 5 of github-pr-review (pool): Per-file code review.
// Each instance reviews one changed file for: correctness, security issues,
// code quality, style, and suggests inline comments. Run in a pool so
// all files are reviewed in parallel — results merged via concat.

import { retry } from "../../extensions/captain/gates/index.js";
import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are a senior code reviewer. Review this changed file from the PR.

PR metadata and changed file:
$INPUT

Review the diff for:

1. **Correctness** — logic errors, off-by-one errors, missing error handling, race conditions
2. **Security** — injection risks, auth bypass, secret exposure, unsafe deserialization
3. **Code quality** — naming clarity, function length, duplication, coupling
4. **Type safety** — any 'any' casts, missing null checks, incorrect types
5. **Tests** — are the changes covered? are existing tests still valid?

For each finding:

### FINDING-N: [title]
- File: [path]
- Line: [line number or range]
- Severity: [CRITICAL|HIGH|MEDIUM|LOW|INFO]
- Category: [correctness|security|quality|types|tests]
- Issue: [clear description]
- Suggestion: [concrete fix or improvement]
- Inline comment: [GitHub PR comment text, ready to post]

End with:
FILE: [path]
FINDINGS: N
CRITICAL: N | HIGH: N | MEDIUM: N | LOW: N
`;

export const reviewPrFile: Step = {
	kind: "step",
	label: "Review PR File",
	tools: ["read", "bash", "grep", "find", "ls"],
	description:
		"Review a single changed file for correctness, security, quality — emit inline comments",
	prompt,
	onFail: retry(),
	transform: full,
};
