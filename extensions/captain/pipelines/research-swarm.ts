// ── Pipeline: Research Swarm ─────────────────────────────────────────────
// Orchestrates 5 parallel researchers + 5 democratic voters + synthesis.
// Phases split across research-swarm-phases-a.ts + phases-b.ts for the
// 200-line limit (Basic_knowledge.md).
//
// Run:  captain_run { name: "captain:research-swarm", input: "your question" }

import type { Runnable, Sequential } from "../types.js";
import { consolidate, plan, researchPhase } from "./research-swarm-phases-a.js";
import { synthesize, votePhase } from "./research-swarm-phases-b.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		plan, //  1️⃣  decompose question into 5 research angles
		researchPhase, //  2️⃣  5 parallel researchers
		consolidate, //  3️⃣  deduplicate & number findings
		votePhase, //  4️⃣  5 parallel voters scoring all findings
		synthesize, //  5️⃣  tally scores + final synthesis
	],
} satisfies Sequential;
