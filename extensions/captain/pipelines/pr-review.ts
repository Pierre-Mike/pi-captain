// ── Pipeline: PR Review ───────────────────────────────────────────────────
// Three-way parallel review (security + performance + quality) → synthesize into verdict.
// Uses `rank` merge to let the synthesizer see all perspectives weighted by quality.
//
// Structure:
//   sequential
//   ├── step: Research (read the changed files and diff)
//   ├── parallel (merge: rank)
//   │   ├── step: Security Audit
//   │   ├── step: Performance Review
//   │   └── step: Quality Review
//   └── step: Synthesize Review (produces APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION)
// Agents: researcher, security-reviewer, reviewer, synthesizer (from ~/.pi/agent/agents/*.md)

import {
	performanceReview,
	qualityReview,
	research,
	securityAuditStep,
	synthesizeReview,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Read and understand the code under review
		{
			...research,
			prompt:
				"You are a code reviewer. Read the files and changes described in the request.\n" +
				"Produce a structured summary of:\n" +
				"- What files are affected\n" +
				"- What the changes do (feature, bugfix, refactor)\n" +
				"- Key design decisions visible in the code\n" +
				"- Any tests added or modified\n\n" +
				"Review request:\n$ORIGINAL",
		},

		// 2. Three parallel review tracks (each gets the research summary as $INPUT)
		{
			kind: "parallel",
			steps: [securityAuditStep, performanceReview, qualityReview],
			merge: { strategy: "rank" },
		},

		// 3. Synthesize all reviews into a single verdict
		synthesizeReview,
	],
};
