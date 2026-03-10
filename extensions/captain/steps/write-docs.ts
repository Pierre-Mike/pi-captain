// ── Step: Write Documentation ────────────────────────────────────────────
// Stage 3b of spec-tdd: Doc-writer produces developer documentation from
// the spec. Runs in parallel with TDD Green.

import { llmFast, warn } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are the Doc Writer. Write developer documentation based on the technical specification.

Technical Specification:
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Read the spec's Public API section for signatures and types
2. Read the existing codebase to understand where docs go:
   - Check for existing README.md, docs/ folder, JSDoc patterns
   - Match the project's documentation style
3. Write documentation that includes:
   - **Overview** — what this feature does and why
   - **Quick Start** — minimal usage example
   - **API Reference** — every public function/type with params, returns, examples
   - **Error Handling** — what errors can be thrown and when
   - **Edge Cases** — known limitations or special behaviors
4. If the project has JSDoc, add JSDoc comments to the API signatures
5. If there's a CHANGELOG, add an entry

Output the documentation and list:
- DOC FILES: (list of documentation files created/modified)
`;

export const writeDocs: Step = {
	kind: "step",
	label: "Write Documentation",
	tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	description:
		"Write developer documentation from the spec (runs in parallel with implementation)",
	prompt,
	// Gate: LLM checks documentation completeness
	gate: llmFast(
		"Does this documentation include: (1) an overview, (2) usage examples, " +
			"(3) API reference with function signatures, (4) error handling docs? " +
			"Rate completeness 0-1. Threshold: 0.6",
	),
	onFail: warn,
	transform: full,
};
