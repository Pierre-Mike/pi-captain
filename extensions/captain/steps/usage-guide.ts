// ── Step: Usage Guide ─────────────────────────────────────────────────────
// Generates end-user documentation: getting started, examples, FAQ

import { file, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const usageGuide: Step = {
	kind: "step",
	label: "Usage Guide",
	agent: "doc-writer",
	description:
		"Generate user-facing documentation with examples and quickstart",
	prompt:
		"You are a developer advocate writing user-facing documentation.\n\n" +
		"1. Read the project source, README, and any existing docs\n" +
		"2. Write a comprehensive usage guide:\n" +
		"   - Prerequisites and installation\n" +
		"   - Quick-start (get running in < 2 minutes)\n" +
		"   - Configuration options with defaults\n" +
		"   - Common use cases with copy-paste code examples\n" +
		"   - CLI commands and flags (if applicable)\n" +
		"   - Troubleshooting / FAQ (anticipate 5+ common issues)\n" +
		"3. Use clear headings, code blocks, and callout boxes\n" +
		"4. Save to docs/guide.md\n\n" +
		"Project context:\n$ORIGINAL",
	// Gate: guide file must exist
	gate: file("docs/guide.md"),
	onFail: retry(2),
	transform: { kind: "full" },
};
