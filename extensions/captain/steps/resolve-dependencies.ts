// ── Step: Resolve Dependencies ────────────────────────────────────────────
// Stage 5 of shredder: Parse dependency graph from validated units, detect
// cycles, topological sort into parallelizable execution layers.

import { regexCI, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Dependency Resolver. Parse the validated units and produce execution layers.

Validated units:
$INPUT

Instructions:
1. Parse each unit's "Dependencies" field into an adjacency list
2. Detect cycles — if any exist, list them and output CYCLES DETECTED: YES
3. Topological sort all units
4. Group into execution layers:
   - Layer 0 = units with no dependencies
   - Layer 1 = units whose deps are all in Layer 0, etc.
5. Within each layer, units can run in parallel

Output format:

## Dependency Graph
(adjacency list: UNIT-N → UNIT-X, UNIT-Y)

## Execution Layers

### Layer 0 (parallel — no dependencies)
- UNIT-N: name
- UNIT-N: name

### Layer 1 (parallel — depends only on Layer 0)
- UNIT-N: name (needs: UNIT-X)

(continue for all layers)

End with:
TOTAL LAYERS: count
CYCLES DETECTED: NO

Also pass through each unit's full details (goal, input, output, acceptance test, score)
grouped under its layer so the next step has everything.

Finally, output a JSON summary block:
\`\`\`json
{"total_layers": N, "cycles_detected": false, "layers": [
  {"id": 0, "units": ["UNIT-1", "UNIT-2"]},
  {"id": 1, "units": ["UNIT-3"]}
]}
\`\`\`
`;

export const resolveDependencies: Step = {
	kind: "step",
	label: "Resolve Dependencies",
	tools: ["read", "bash"],
	model: "flash",
	temperature: 0,
	description:
		"Build adjacency graph, detect cycles, topological sort into parallelizable execution layers",
	prompt,
	gate: regexCI("cycles.detected.*no"),
	onFail: retry(2),
	transform: { kind: "full" },
};
