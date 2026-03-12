// ── research-swarm-phases-b.ts — Phases 4-5: vote, synthesize ───────────────
import { warn } from "../gates/on-fail.js";
import { concat } from "../merge.js";
import { full } from "../transforms/presets.js";
import type { Parallel, Step } from "../types.js";
import { voterStep } from "./research-swarm-phases-a.js";

// ── Phase 4: Vote ─────────────────────────────────────────────────────────

const votePhase: Parallel = {
	kind: "parallel",
	steps: [
		voterStep("V1"),
		voterStep("V2"),
		voterStep("V3"),
		voterStep("V4"),
		voterStep("V5"),
	],
	merge: concat,
};

// ── Phase 5: Synthesize ───────────────────────────────────────────────────

const synthesize: Step = {
	kind: "step",
	label: "Synthesize",
	model: "sonnet",
	tools: [],
	prompt: `You are the lead researcher producing the final synthesis.

Original question: "$ORIGINAL"

The input below contains all 5 voter scorecards. Do the following:

1. **Tally scores**: For each finding [F1], [F2], …, calculate the average across all 5 voters.
2. **Classify**:
   - Average ≥ 7.0 → ✅ Accepted
   - Average 5.0–6.9 → ⚠️  Contested
   - Average < 5.0 → ❌ Rejected
3. **Resolve ties**: If two accepted findings have averages within 0.5, note the tie.
4. **Write the final answer** that:
   - Directly answers "$ORIGINAL"
   - Integrates accepted findings in ranked order
   - Notes contested findings with their debate summary
   - Includes any strong dissenting votes (voter scored an accepted finding < 5)

Output the complete synthesis inline now.

---
## All Voter Scorecards
$INPUT`,
	gate: () => true,
	onFail: warn,
	transform: full,
};

// ── Pipeline Assembly ─────────────────────────────────────────────────────

export { votePhase, synthesize };
