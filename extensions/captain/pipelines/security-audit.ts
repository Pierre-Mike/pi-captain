// ── Pipeline: Security Audit ──────────────────────────────────────────────
// Full security audit: dependency scan → parallel OWASP/secrets/auth → red team → report.
// The parallel block covers three orthogonal security vectors simultaneously.
// The red team step operates on merged findings to look for exploit chains.
// Final report is saved to docs/security-audit.md.
//
// Structure:
//   sequential
//   ├── step: Dependency Scan
//   ├── parallel (merge: concat)
//   │   ├── step: OWASP Top 10 Check
//   │   ├── step: Secret Scan
//   │   └── step: Auth Review
//   ├── step: Red Team Assessment ← adversarial analysis of merged findings
//   └── step: Security Report (gate: file docs/security-audit.md, transform: summarize)
// Agents: security-reviewer, red-team, synthesizer (from ~/.pi/agent/agents/*.md)

import {
	authReview,
	dependencyScan,
	owaspCheck,
	redTeamAssessment,
	secretScan,
	securityReport,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Scan dependencies for known vulnerabilities
		dependencyScan,

		// 2. Three parallel security reviews covering different vectors
		{
			kind: "parallel",
			steps: [
				owaspCheck, // OWASP Top 10 categories
				secretScan, // Hardcoded secrets and credentials
				authReview, // Authentication & authorization deep dive
			],
			merge: { strategy: "concat" },
		},

		// 3. Red team: adversarial review of all findings, looking for exploit chains
		redTeamAssessment,

		// 4. Final executive report
		securityReport,
	],
};
