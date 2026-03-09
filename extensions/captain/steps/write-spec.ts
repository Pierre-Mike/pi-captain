// ── Step: Write Technical Spec ────────────────────────────────────────────
// Stage 1 of spec-tdd: Architect analyzes codebase and produces a detailed,
// testable technical specification from the raw requirement.

import { allOf, llmFast, retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are the Spec Writer. Analyze this requirement and the existing codebase to produce
a detailed technical specification.

Requirement:
$ORIGINAL

Instructions:
1. Use \`find\` and \`ls\` to understand the project structure
2. Use \`read\` to examine existing code, types, patterns, and test conventions
3. Identify what files need to be created or modified
4. Identify the test framework and testing patterns already in use

Produce a spec in this EXACT format:

# Technical Specification

## Summary
(What this feature/change does in 1-2 sentences)

## Requirements
1. (functional requirement — testable)
2. ...

## Public API
(Functions, types, interfaces to expose — with signatures)

## Files to Create/Modify
- \`path/to/file.ts\` — (what changes)
- \`path/to/file.test.ts\` — (test file)

## Acceptance Criteria
1. (specific, testable criterion)
2. ...

## Edge Cases
- (boundary condition to handle)

## Constraints
- (technical limitations, compatibility requirements)

## Test Strategy
- Unit tests: (what to test)
- Edge case tests: (boundary scenarios)
- Error handling tests: (failure modes)

Be precise. Every requirement and acceptance criterion must be directly testable.
`;

export const writeSpec: Step = {
	kind: "step",
	label: "Write Technical Spec",
	tools: ["read", "bash", "grep", "find", "ls"],
	temperature: 0.3,
	description:
		"Analyze the requirement and codebase, then produce a detailed technical specification",
	prompt,
	gate: allOf(
		({ output }) => {
			const lo = output.toLowerCase();
			const missing = [
				"acceptance criteria",
				"public api",
				"test strategy",
			].filter((s) => !lo.includes(s));
			return missing.length === 0
				? true
				: `Spec missing sections: ${missing.join(", ")}`;
		},
		llmFast(
			"Does this technical spec contain: (1) clear testable requirements, " +
				"(2) specific file paths, (3) public API signatures, (4) acceptance criteria, " +
				"(5) edge cases? Rate completeness 0-1. Threshold: 0.7",
		),
	),
	onFail: retry,
	transform: full,
};
