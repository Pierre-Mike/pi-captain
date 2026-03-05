// ── Step: Security Audit (PR Review) ──────────────────────────────────────
// Security-focused code review for pull requests

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const securityAuditStep: Step = {
	kind: "step",
	label: "Security Audit",
	agent: "security-reviewer",
	description: "Review code changes for security vulnerabilities",
	prompt:
		"You are a security auditor reviewing code changes.\n\n" +
		"Examine the codebase for:\n" +
		"1. Injection vulnerabilities (SQL, XSS, command injection)\n" +
		"2. Authentication & authorization flaws\n" +
		"3. Sensitive data exposure (secrets, PII, tokens in logs)\n" +
		"4. Insecure dependencies or outdated packages\n" +
		"5. Input validation gaps\n" +
		"6. CSRF, SSRF, and path traversal risks\n\n" +
		"For each finding, report:\n" +
		"- Severity: CRITICAL / HIGH / MEDIUM / LOW\n" +
		"- Location: file path and line\n" +
		"- Description and recommended fix\n\n" +
		"Code to review:\n$INPUT\n\nContext:\n$ORIGINAL",
	// Gate: review must be substantive
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
