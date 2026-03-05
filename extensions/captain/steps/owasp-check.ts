// ── Step: OWASP Top 10 Check ──────────────────────────────────────────────
// Reviews code against the OWASP Top 10 vulnerability categories

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const owaspCheck: Step = {
	kind: "step",
	label: "OWASP Top 10 Check",
	agent: "security-reviewer",
	description: "Audit codebase against OWASP Top 10 vulnerability categories",
	prompt:
		"You are a security auditor checking code against the OWASP Top 10.\n\n" +
		"Review the codebase for each category:\n" +
		"1. A01: Broken Access Control — missing auth checks, IDOR, path traversal\n" +
		"2. A02: Cryptographic Failures — weak hashing, plaintext secrets, bad TLS\n" +
		"3. A03: Injection — SQL, NoSQL, OS command, LDAP injection\n" +
		"4. A04: Insecure Design — missing threat modeling, logic flaws\n" +
		"5. A05: Security Misconfiguration — default creds, verbose errors, open CORS\n" +
		"6. A06: Vulnerable Components — (covered by dependency scan, note any additions)\n" +
		"7. A07: Auth Failures — weak passwords, missing MFA, session fixation\n" +
		"8. A08: Data Integrity Failures — deserialization, unsigned updates\n" +
		"9. A09: Logging Failures — missing audit logs, sensitive data in logs\n" +
		"10. A10: SSRF — unvalidated URLs, internal network access\n\n" +
		"For each finding: Category → Severity → File → Description → Fix\n\n" +
		"Project context:\n$ORIGINAL",
	gate: outputMinLength(200),
	onFail: retry(2),
	transform: { kind: "full" },
};
