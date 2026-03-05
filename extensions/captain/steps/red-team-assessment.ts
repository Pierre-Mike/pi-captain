// ── Step: Red Team Assessment ─────────────────────────────────────────────
// Adversarial assessment: thinks like an attacker to find exploit chains

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const redTeamAssessment: Step = {
	kind: "step",
	label: "Red Team Assessment",
	agent: "red-team",
	description:
		"Adversarial assessment — thinks like an attacker to find exploit chains",
	prompt:
		"You are a red team operator. Previous security scans have been performed.\n" +
		"Your job is to think like a real attacker and find what the automated scans missed.\n\n" +
		"1. Review the scan findings for false negatives and overlooked attack surfaces\n" +
		"2. Look for EXPLOIT CHAINS — combining multiple low-severity issues into a high-impact attack\n" +
		"3. Test business logic flaws (price manipulation, race conditions, state confusion)\n" +
		"4. Check for information disclosure through error messages, headers, timing\n" +
		"5. Evaluate the blast radius: if one component is compromised, what else falls?\n" +
		"6. Attempt privilege escalation paths\n" +
		"7. Check for supply chain attack vectors\n\n" +
		"For each attack scenario:\n" +
		"- Attack Name → Steps to Exploit → Impact → Likelihood → Recommended Mitigation\n\n" +
		"Previous scan results:\n$INPUT\n\nProject context:\n$ORIGINAL",
	gate: outputMinLength(200),
	onFail: retry(2),
	transform: { kind: "full" },
};
