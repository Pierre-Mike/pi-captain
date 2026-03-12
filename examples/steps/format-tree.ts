// ── Step: Format Tree ────────────────────────────────────────────────────
// Stage 6 of shredder: Structure the layered units into a final nested
// task tree with summary statistics.

import { full } from "../../extensions/captain/transforms/presets.js";
import type { Step } from "../../extensions/captain/types.js";

const prompt = `
You are the Tree Formatter. Take these execution layers and produce the final task tree.

Layered units:
$INPUT

Original requirement:
$ORIGINAL

Output format:

# Task Tree: <title>

For each execution layer:

## Layer N (parallel | sequential) — <description>

For each unit in the layer:

### UNIT-N: <name> [score: X]
- Goal: <one sentence>
- Input: <what it receives>
- Output: <what it produces>
- Acceptance Test: <how to verify>
- Depends on: <UNIT-X or none>

End with:

## Summary
- Total units: N
- Execution layers: N
- Max parallelism: N (largest layer)
- Critical path length: N (longest dependency chain)
- All Haiku-safe: YES
`;

export const formatTree: Step = {
	kind: "step",
	label: "Format Tree",
	tools: ["read", "bash"],
	model: "sonnet",
	description: "Structure layered units into the final nested task tree",
	prompt,
	transform: full,
};
