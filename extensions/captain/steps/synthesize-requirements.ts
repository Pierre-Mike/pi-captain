// ── Step: Synthesize Requirements ─────────────────────────────────────────
// Stage 4 of requirements-gathering: Takes all gathered intelligence from
// exploration → deep-dive → challenge phases and produces a comprehensive,
// professional requirements document written to REQUIREMENTS.md.

import { allOf, file, llmFast, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Requirements Synthesizer. Produce a definitive requirements document.

Original requirement:
$ORIGINAL

All gathered intelligence (exploration → deep-dive → challenge → user confirmations):
$INPUT

Write a comprehensive requirements document to \`REQUIREMENTS.md\`.

The document MUST follow this EXACT structure:

# Requirements Document

## 1. Executive Summary
(2-3 sentences capturing the essence of the project)

## 2. Problem Statement
(What problem, for whom, why it matters, what triggered it)

## 3. Goals & Success Metrics
(Measurable outcomes — each goal has a metric and target value)

## 4. User Personas
(Name, role, context, needs, pain points — for each persona)

## 5. User Stories
(As a [persona], I want [action], so that [benefit])
(Each story has numbered acceptance criteria)

## 6. Functional Requirements
| ID | Requirement | Priority | Acceptance Criteria |
|------|-------------|----------|---------------------|
| FR-001 | ... | Must | ... |
(Use MoSCoW: Must / Should / Could / Won't)

## 7. Non-Functional Requirements
| ID | Category | Requirement | Target |
|------|----------|-------------|--------|
| NFR-001 | Performance | ... | ... |
(Cover: performance, security, scalability, accessibility, reliability)

## 8. Constraints & Assumptions
### Constraints
(technical, business, timeline, budget — things we cannot change)
### Assumptions
(things we believe to be true but haven't fully verified)

## 9. System Context & Integration
(External systems, APIs, data sources, integration points)

## 10. Data Requirements
(Data models, storage, privacy, retention, migration needs)

## 11. Acceptance Criteria Summary
(Top-level criteria for the project as a whole to be considered done)

## 12. Priority Matrix (MoSCoW)
### Must Have
(list)
### Should Have
(list)
### Could Have
(list)
### Won't Have (this iteration)
(list)

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|

## 14. Open Questions
(Anything still unresolved that needs future attention)

## 15. Appendix
(Discovery notes, raw context, references)

Rules:
- Every requirement MUST be testable and unambiguous
- Use consistent ID numbering (FR-001, NFR-001)
- MoSCoW priority on every functional requirement
- Include at least one user story per persona
- Write the file using the write tool
- Confirm the file was written by listing it
`;

export const synthesizeRequirements: Step = {
	kind: "step",
	label: "Synthesize Requirements",
	tools: ["read", "bash", "write"],
	model: "flash",
	temperature: 0.3,
	description:
		"Produce the final comprehensive requirements document from all gathered intelligence",
	prompt,
	gate: allOf(
		file("REQUIREMENTS.md"),
		llmFast(
			"Evaluate this requirements document for: (1) clear testable requirements with IDs, " +
				"(2) MoSCoW priorities on all functional requirements, (3) user stories with " +
				"acceptance criteria, (4) non-functional requirements covering performance and " +
				"security, (5) risks with mitigations, (6) completeness — does it feel like a " +
				"real, actionable spec? Rate 0-1. Threshold: 0.7",
		),
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
