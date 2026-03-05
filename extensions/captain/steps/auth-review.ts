// ── Step: Auth Review ─────────────────────────────────────────────────────
// Deep review of authentication and authorization implementation

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const authReview: Step = {
	kind: "step",
	label: "Auth Review",
	agent: "security-reviewer",
	description: "Deep review of authentication and authorization patterns",
	prompt:
		"You are a security engineer specializing in auth systems.\n\n" +
		"Thoroughly review the authentication and authorization implementation:\n" +
		"1. Session management: secure cookies, httpOnly, sameSite, expiration\n" +
		"2. Password handling: hashing algorithm (bcrypt/argon2), salt, min length\n" +
		"3. Token management: JWT validation, expiration, refresh flow, revocation\n" +
		"4. Authorization: RBAC/ABAC implementation, privilege escalation risks\n" +
		"5. Rate limiting on auth endpoints (login, register, password reset)\n" +
		"6. Account enumeration prevention (consistent error messages)\n" +
		"7. Multi-factor authentication support\n" +
		"8. OAuth/SSO integration security (state param, PKCE, redirect validation)\n\n" +
		"For each finding: Severity → Component → Issue → Recommendation\n\n" +
		"Project context:\n$ORIGINAL",
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
