// ── Step: Architecture Documentation ──────────────────────────────────────
// Generates high-level architecture docs: system design, data flow, modules

import { file, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const architectureDocs: Step = {
	kind: "step",
	label: "Architecture Docs",
	agent: "doc-writer",
	description: "Generate architecture documentation from the codebase",
	prompt:
		"You are a technical writer documenting a project's architecture.\n\n" +
		"1. Read the project's source files, config, and directory structure\n" +
		"2. Document the high-level architecture:\n" +
		"   - System overview and purpose\n" +
		"   - Module breakdown with responsibilities\n" +
		"   - Data flow between components\n" +
		"   - External dependencies and integrations\n" +
		"   - Configuration and environment variables\n" +
		"3. Include a module dependency diagram (ASCII art or Mermaid)\n" +
		"4. Document design decisions and trade-offs\n" +
		"5. Save to docs/architecture.md\n\n" +
		"Project context:\n$ORIGINAL",
	// Gate: architecture doc file must exist
	gate: file("docs/architecture.md"),
	onFail: retry(2),
	transform: { kind: "full" },
};
