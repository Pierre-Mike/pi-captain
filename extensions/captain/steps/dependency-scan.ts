// ── Step: Dependency Scan ─────────────────────────────────────────────────
// Scans dependencies for known vulnerabilities and outdated packages

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const dependencyScan: Step = {
	kind: "step",
	label: "Dependency Scan",
	agent: "security-reviewer",
	description:
		"Scan dependencies for known vulnerabilities and security issues",
	prompt:
		"You are a security engineer auditing project dependencies.\n\n" +
		"1. Read package.json and bun.lockb (or package-lock.json)\n" +
		"2. Run `bun pm ls` to list all resolved dependencies\n" +
		"3. Check for known vulnerable packages (check changelogs, CVE databases)\n" +
		"4. Flag packages that are unmaintained (no updates in 2+ years)\n" +
		"5. Check for typosquatting risks (similarly-named malicious packages)\n" +
		"6. Verify no packages have install scripts that could be malicious\n\n" +
		"Produce a vulnerability report:\n" +
		"- Package → Version → Risk Level → CVE/Issue → Recommendation\n\n" +
		"Project context:\n$ORIGINAL",
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
