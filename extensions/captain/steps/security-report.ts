// ── Step: Security Report ─────────────────────────────────────────────────
// Synthesizes all security findings into a final executive report

import { file, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const securityReport: Step = {
	kind: "step",
	label: "Security Report",
	agent: "synthesizer",
	description:
		"Synthesize all security findings into an executive report with remediation plan",
	prompt:
		"You are a security lead producing the final audit report.\n\n" +
		"1. Consolidate all findings from dependency scan, OWASP check, secret scan, " +
		"auth review, and red team assessment\n" +
		"2. Deduplicate and cross-reference findings\n" +
		"3. Assign a final severity to each unique finding: CRITICAL / HIGH / MEDIUM / LOW / INFO\n" +
		"4. Produce an executive summary with overall risk rating (A through F)\n" +
		"5. Create a prioritized remediation plan with effort estimates\n" +
		"6. Save the full report to docs/security-audit.md\n\n" +
		"Format:\n" +
		"# Security Audit Report\n" +
		"## Overall Rating: <A-F>\n" +
		"## Executive Summary\n" +
		"## Critical Findings\n" +
		"## Remediation Plan (prioritized)\n" +
		"## Detailed Findings\n" +
		"## Appendix: Raw Scan Data\n\n" +
		"All findings:\n$INPUT\n\nProject context:\n$ORIGINAL",
	// Gate: report file must be created
	gate: file("docs/security-audit.md"),
	onFail: retry(2),
	transform: { kind: "summarize" },
};
