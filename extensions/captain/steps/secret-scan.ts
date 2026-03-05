// ── Step: Secret Scan ─────────────────────────────────────────────────────
// Scans the codebase for hardcoded secrets, tokens, and credentials

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const secretScan: Step = {
	kind: "step",
	label: "Secret Scan",
	agent: "security-reviewer",
	description: "Scan codebase for hardcoded secrets, tokens, and credentials",
	prompt:
		"You are a security engineer scanning for exposed secrets.\n\n" +
		"Search the entire codebase for:\n" +
		"1. API keys and tokens (AWS, GCP, Stripe, GitHub, etc.)\n" +
		"2. Passwords and credentials (including in config files)\n" +
		"3. Private keys and certificates\n" +
		"4. Database connection strings with credentials\n" +
		"5. JWT secrets and signing keys\n" +
		"6. .env files committed to source (check .gitignore)\n" +
		"7. Secrets in comments, TODOs, or debug code\n" +
		"8. Base64-encoded secrets\n\n" +
		"Use grep/find to search for patterns like:\n" +
		"- 'sk-', 'pk_', 'AKIA', 'ghp_', 'glpat-', 'Bearer '\n" +
		"- 'password', 'secret', 'token', 'apikey', 'api_key'\n\n" +
		"For each finding: File → Line → Type → Redacted Value → Recommendation\n\n" +
		"Project context:\n$ORIGINAL",
	gate: outputMinLength(50),
	onFail: retry(2),
	transform: { kind: "full" },
};
