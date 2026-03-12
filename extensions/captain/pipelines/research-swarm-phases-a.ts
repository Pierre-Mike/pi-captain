// ── research-swarm-phases-a.ts — Phases 1-3: plan, research, consolidate ───
import { warn } from "../gates/on-fail.js";
import { concat } from "../merge.js";
import { full } from "../transforms/presets.js";
import type { Parallel, Step } from "../types.js";

// ── Phase 1: Plan ─────────────────────────────────────────────────────────

const plan: Step = {
	kind: "step",
	label: "Plan",
	model: "sonnet",
	tools: ["bash", "read"],
	prompt: `You are the lead researcher orchestrating a 5-agent research swarm.

Your task: decompose this research question into 5 distinct search angles.
Question: "$ORIGINAL"

Explore the codebase at the current working directory with bash/read to understand
what framework is being evaluated (look at README, package.json, key source files).

Then output ONLY the plan below (no preamble, no explanation):

# Research Swarm Plan
## Question
$ORIGINAL

## Search Angles

### [R1] Official API & Design Philosophy
- **Focus**: What the framework explicitly claims to be; its stated design goals
- **Search terms**: readme design philosophy, types.ts Step Runnable, executor.ts architecture
- **Source type**: codebase

### [R2] Developer Experience & Ergonomics
- **Focus**: How easy/hard is it to define and run pipelines? Boilerplate? Type safety?
- **Search terms**: pipeline definition syntax, typescript ergonomics, onboarding friction
- **Source type**: codebase + web

### [R3] Competing Frameworks — Feature Matrix
- **Focus**: What do LangGraph, CrewAI, AutoGen, Prefect, Temporal offer that this lacks?
- **Search terms**: LangGraph vs CrewAI comparison 2024 2025, AutoGen multi-agent orchestration
- **Source type**: web

### [R4] Production Readiness & Missing Features
- **Focus**: Error handling, observability, persistence, scalability gaps
- **Search terms**: LLM orchestration production observability tracing, state persistence agents
- **Source type**: web + codebase

### [R5] Contrarian / Niche Perspectives
- **Focus**: Is this category even needed? Simpler alternatives? Anti-patterns?
- **Search terms**: LLM orchestration frameworks too complex, simple LLM pipelines bash alternative
- **Source type**: web`,
	gate: () => true,
	onFail: warn,
	transform: full,
};

// ── Phase 2: Research ──────────────────────────────────────────────────────

function researcherStep(id: "R1" | "R2" | "R3" | "R4" | "R5"): Step {
	return {
		kind: "step",
		label: `Researcher ${id}`,
		model: "sonnet",
		tools: ["read", "bash", "web_search"],
		prompt: `You are researcher ${id} in a 5-agent research swarm.

## Context
Original question: "$ORIGINAL"

The plan below was produced by the lead researcher. Find the section labeled [${id}]
and execute that search strategy. Ignore all other [Rx] sections.

## Plan
$INPUT

## Your job
1. Read the [${id}] section of the plan above.
2. Execute the prescribed search strategy:
   - If "codebase": use bash (grep, find, cat) on the project in the working directory
   - If "web": use web_search with 2-3 targeted queries
   - If "both": do both
3. Return your findings as structured markdown:

## Researcher ${id} Findings

### Finding 1: <title>
- **Source**: <URL or file:line>
- **Summary**: 2-4 sentences
- **Strength**: key advantage or evidence
- **Weakness**: limitation or caveat

### Finding 2: <title>
...

(3-5 high-quality findings. Quality over quantity. Include concrete evidence.)

End with: "Done. ${id} contributed N findings."`,
		gate: () => true,
		onFail: warn,
		transform: full,
	};
}

const researchPhase: Parallel = {
	kind: "parallel",
	steps: [
		researcherStep("R1"),
		researcherStep("R2"),
		researcherStep("R3"),
		researcherStep("R4"),
		researcherStep("R5"),
	],
	merge: concat,
};

// ── Phase 3: Consolidate ──────────────────────────────────────────────────

const consolidate: Step = {
	kind: "step",
	label: "Consolidate",
	model: "sonnet",
	tools: [],
	prompt: `You are the lead researcher. All 5 agents have finished searching.

Original question: "$ORIGINAL"

Below is the combined output from all 5 researchers. Your tasks:
1. Identify and merge duplicate findings (same insight, different wording).
   When merging, attribute to all researchers who found it (e.g. [R1][R3]).
2. Number every unique finding [F1], [F2], … [FN].
3. Output the consolidated list in this format:

# Consolidated Findings

## [F1] <Title>
- **Found by**: [R1][R3]
- **Summary**: <merged summary>
- **Strength**: <best strength from all versions>
- **Weakness**: <most important caveat>

## [F2] …

(Include ALL unique findings. Do not drop any.)

---
## All Researcher Outputs
$INPUT`,
	gate: () => true,
	onFail: warn,
	transform: full,
};

// ── Phase 4: Vote ─────────────────────────────────────────────────────────

function voterStep(id: "V1" | "V2" | "V3" | "V4" | "V5"): Step {
	return {
		kind: "step",
		label: `Voter ${id}`,
		model: "flash",
		tools: [],
		prompt: `You are voter ${id} in a democratic research evaluation.

Original question: "$ORIGINAL"

Below are all consolidated findings. Score EACH finding [F1], [F2], … from 1-10:
- **10**: Essential, directly answers the question with strong evidence
- **7-9**: Highly relevant, well-supported
- **4-6**: Partially relevant or weakly supported
- **1-3**: Tangential, weak, or already widely known

Output ONLY your scorecard (no preamble):

## Scorecard ${id}

| Finding | Score | Argument |
|---------|-------|----------|
| [F1] <title> | 8 | <one sentence why> |
| [F2] <title> | 5 | <one sentence why> |
…

---
## Consolidated Findings
$INPUT`,
		gate: () => true,
		onFail: warn,
		transform: full,
	};
}

export { plan, researchPhase, consolidate, voterStep };
