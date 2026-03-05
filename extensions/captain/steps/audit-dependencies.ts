// ── Step: Audit Dependencies ──────────────────────────────────────────────
// Scans the project for outdated, vulnerable, or incompatible dependencies

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const auditDependencies: Step = {
	kind: "step",
	label: "Audit Dependencies",
	agent: "architect",
	description: "Audit current dependencies for compatibility, age, and risk",
	prompt:
		"You are a dependency auditor analyzing a project's package.json and lock file.\n\n" +
		"1. Read package.json and identify all dependencies\n" +
		"2. Check for deprecated or unmaintained packages\n" +
		"3. Identify version conflicts or peer dependency issues\n" +
		"4. Flag packages with known vulnerabilities\n" +
		"5. Note which packages are blocking the migration\n" +
		"6. Produce a dependency matrix: package → current version → target version → risk\n\n" +
		"Migration context:\n$ORIGINAL",
	// Gate: must produce a structured dependency analysis
	gate: assert(
		"output.includes('package') || output.includes('dependency') || output.includes('version')",
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
