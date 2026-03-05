// ── Pipeline: Shredder ───────────────────────────────────────────────────
// Takes any requirement → clarifies → decomposes → shrinks to Haiku-safe
// units → validates with Flash dry-run → resolves dependency graph into
// parallelizable execution layers → outputs a structured task tree →
// renders a visual backlog.canvas for Obsidian.
// No execution — planning only.
// Blueprint: agent/extensions/shrinker/blueprint.canvas
// Agents: clarifier, decomposer, shrinker, validator, resolver, canvas-renderer (from ~/.pi/agent/agents/*.md)

import { assert, command, none, retry, skip } from "../gates/index.js";
import type { Runnable, Step } from "../types.js";

// ── Steps ────────────────────────────────────────────────────────────────

/** Stage 1: Raw requirement → structured spec */
const captureAndClarify: Step = {
	kind: "step",
	label: "Capture and Clarify",
	agent: "clarifier",
	description: "Transform raw requirement into a structured spec",
	prompt:
		"You are the Clarifier. Take this raw requirement and produce a structured spec.\n\n" +
		"Requirement:\n$ORIGINAL\n\n" +
		"Produce a spec in this exact format:\n\n" +
		"## STRUCTURED SPEC\n\n" +
		"### Title\n(concise name)\n\n" +
		"### Inputs\n- (what the system receives)\n\n" +
		"### Outputs\n- (what the system produces)\n\n" +
		"### Acceptance Criteria\n1. (testable criterion)\n2. ...\n\n" +
		"### Constraints\n- (limitations, boundaries)\n\n" +
		"### Edge Cases\n- (unusual scenarios to handle)\n\n" +
		"Be precise. Eliminate all ambiguity. If the requirement is vague, make reasonable assumptions and state them explicitly.",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};

/** Stage 2: Spec → atomic sub-tasks */
const decompose: Step = {
	kind: "step",
	label: "Decompose",
	agent: "decomposer",
	description: "Recursively split the spec into atomic sub-tasks",
	prompt:
		"You are the Decomposer. Take this structured spec and break it into atomic sub-tasks.\n\n" +
		"Spec:\n$INPUT\n\n" +
		"Rules for each sub-task:\n" +
		"- Self-contained: no hidden dependencies\n" +
		"- Single-responsibility: exactly one clear outcome\n" +
		"- Testable: include a pass/fail acceptance test\n\n" +
		"For each sub-task output:\n\n" +
		"### UNIT-N: name\n" +
		"- Goal: one sentence\n" +
		"- Input: what it receives\n" +
		"- Output: what it produces\n" +
		"- Acceptance Test: how to verify\n" +
		"- Dependencies: none or UNIT-X (comma-separated if multiple)\n\n" +
		"Decompose further if a sub-task needs multi-step reasoning.\n" +
		"End with TOTAL UNITS: count",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};

/** Stage 3: Score complexity, re-split until Haiku-safe (composite ≤ 2) */
const shrinkAndScore: Step = {
	kind: "step",
	label: "Shrink and Score",
	agent: "shrinker",
	description:
		"Score complexity and re-split any unit above the Haiku-safe threshold",
	prompt:
		"You are the Shrinker. Score each unit's complexity.\n\n" +
		"Units:\n$INPUT\n\n" +
		"Score each on 1-5:\n" +
		"- Token Context (1=under 500 tokens, 2=under 1K, 3=under 2K, 4=under 4K, 5=over 4K)\n" +
		"- Decision Count (1=zero/one decision, 2=two, 3=three, 4=four+, 5=complex branching)\n" +
		"- Reasoning Depth (1=lookup/copy, 2=simple transform, 3=single inference, 4=chain of 2, 5=deep chain)\n\n" +
		"Composite = max of all three. Target: composite 2 or below (Haiku-safe).\n\n" +
		"For each unit:\n" +
		"### UNIT-N: name\n" +
		"- Token: X | Decision: X | Reasoning: X\n" +
		"- Composite: X — PASS or FAIL\n" +
		"- Dependencies: (preserve from input — none or UNIT-X)\n\n" +
		"For any FAIL unit, decompose it inline into smaller sub-units and re-score.\n" +
		"When splitting a unit, update dependency references: units that depended on the\n" +
		"split unit should depend on its children instead.\n" +
		"Repeat until every unit passes.\n\n" +
		"Output only the final passing units with their scores and dependencies.\n" +
		"End with:\n" +
		"SHRUNKEN UNITS READY: count\n" +
		"ALL PASS: YES",
	gate: none,
	onFail: retry(3),
	transform: { kind: "full" },
};

/** Stage 4: Flash dry-run — confirm each leaf is executable in one pass */
const validate: Step = {
	kind: "step",
	label: "Validate",
	agent: "validator",
	description:
		"Flash dry-run: confirm each unit can be executed in a single pass with no ambiguity",
	prompt:
		"You are the Validator. You are a small, fast model.\n" +
		"For each unit below, answer ONE question:\n" +
		'"Given this goal, input, and constraints — can I produce the expected output in a single pass with no ambiguity?"\n\n' +
		"Units:\n$INPUT\n\n" +
		"For each unit output exactly:\n" +
		"### UNIT-N: name\n" +
		"- Verdict: YES or NO\n" +
		"- Reason: (one sentence)\n" +
		"- Dependencies: (pass through from input)\n\n" +
		"Then output a summary:\n" +
		"VALIDATED: X / Y\n" +
		'FAILED UNITS: (comma-separated list, or "none")\n\n' +
		"If all units passed, end with exactly:\n" +
		"ALL VALIDATED: YES\n\n" +
		"If any failed, end with exactly:\n" +
		"ALL VALIDATED: NO",
	gate: assert("ALL VALIDATED: YES"),
	onFail: retry(3),
	transform: { kind: "full" },
};

/** Stage 5: Parse dependency graph, detect cycles, topological sort into layers */
const resolveDependencies: Step = {
	kind: "step",
	label: "Resolve Dependencies",
	agent: "resolver",
	description:
		"Build adjacency graph, detect cycles, topological sort into parallelizable execution layers",
	prompt:
		"You are the Dependency Resolver. Parse the validated units and produce execution layers.\n\n" +
		"Validated units:\n$INPUT\n\n" +
		"Instructions:\n" +
		'1. Parse each unit\'s "Dependencies" field into an adjacency list\n' +
		"2. Detect cycles — if any exist, list them and output CYCLES DETECTED: YES\n" +
		"3. Topological sort all units\n" +
		"4. Group into execution layers: Layer 0 = units with no dependencies,\n" +
		"   Layer 1 = units whose deps are all in Layer 0, etc.\n" +
		"5. Within each layer, units can run in parallel\n\n" +
		"Output format:\n\n" +
		"## Dependency Graph\n" +
		"(adjacency list: UNIT-N → UNIT-X, UNIT-Y)\n\n" +
		"## Execution Layers\n\n" +
		"### Layer 0 (parallel — no dependencies)\n" +
		"- UNIT-N: name\n" +
		"- UNIT-N: name\n\n" +
		"### Layer 1 (parallel — depends only on Layer 0)\n" +
		"- UNIT-N: name (needs: UNIT-X)\n\n" +
		"(continue for all layers)\n\n" +
		"End with:\n" +
		"TOTAL LAYERS: count\n" +
		"CYCLES DETECTED: NO\n\n" +
		"Also pass through each unit's full details (goal, input, output, acceptance test,\n" +
		"score) grouped under its layer so the next step has everything.",
	gate: assert("CYCLES DETECTED: NO"),
	onFail: retry(2), // cycle detected → retry decomposition with context
	transform: { kind: "full" },
};

/** Stage 6: Format layered units into the final task tree */
const formatTree: Step = {
	kind: "step",
	label: "Format Tree",
	agent: "shrinker",
	description: "Structure layered units into the final nested task tree",
	prompt:
		"You are the Tree Formatter. Take these execution layers and produce the final task tree.\n\n" +
		"Layered units:\n$INPUT\n\n" +
		"Original requirement:\n$ORIGINAL\n\n" +
		"Output format:\n\n" +
		"# Task Tree: <title>\n\n" +
		"For each execution layer:\n\n" +
		"## Layer N (parallel | sequential) — <description>\n\n" +
		"For each unit in the layer:\n\n" +
		"### UNIT-N: <name> [score: X]\n" +
		"- Goal: <one sentence>\n" +
		"- Input: <what it receives>\n" +
		"- Output: <what it produces>\n" +
		"- Acceptance Test: <how to verify>\n" +
		"- Depends on: <UNIT-X or none>\n\n" +
		"End with:\n\n" +
		"## Summary\n" +
		"- Total units: N\n" +
		"- Execution layers: N\n" +
		"- Max parallelism: N (largest layer)\n" +
		"- Critical path length: N (longest dependency chain)\n" +
		"- All Haiku-safe: YES",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};

// ── Canvas rendering prompt — kept as a const for readability ────────────
// Encodes the JSON Canvas spec rules, layout strategy, and validation step.
const CANVAS_PROMPT =
	"You are the Canvas Renderer. Convert the task tree into a JSON Canvas file named backlog.canvas.\n\n" +
	"Task tree:\n$INPUT\n\n" +
	"Original requirement:\n$ORIGINAL\n\n" +
	"## JSON Canvas Format Rules\n\n" +
	"The canvas is JSON with two arrays: `nodes` and `edges`.\n" +
	"Node types: `text` (markdown content), `group` (visual container with `label`).\n" +
	"Every element needs a unique `id` — use 16-char hex strings for nodes, `edge-NNN` for edges.\n" +
	"Property order: `type`, `id`, `x`, `y`, `width`, `height`, then optional fields (`color`, `text`, `label`).\n\n" +
	"## Color Scheme\n" +
	'- `"1"` (red) = title/header node\n' +
	'- `"4"` (green) = parallel layer groups\n' +
	'- `"5"` (purple) = sequential layer groups\n' +
	'- `"6"` (cyan) = summary node\n' +
	"- No color = unit text nodes (default canvas color)\n\n" +
	"## Layout Strategy — Top-Down Layer Flow\n\n" +
	'1. **Title node** at top: the requirement title, color `"1"`, width 700, height 120\n' +
	"2. **One group node per execution layer**, stacked vertically with 60px gaps between groups\n" +
	'   - Group label = `"Layer N (parallel)"` or `"Layer N (sequential)"`\n' +
	'   - Group color = `"4"` for parallel, `"5"` for sequential\n' +
	"3. **Text nodes inside each group** — one per unit, arranged in a grid:\n" +
	"   - Max 3 columns, each unit node width = 340, height = 200\n" +
	"   - 20px padding from group edges, 20px gap between unit nodes\n" +
	"   - Unit text format: `## UNIT-N: name\\n\\n**Score:** X\\n**Goal:** ...\\n**Test:** ...`\n" +
	"   - Group width = min(unitCount, 3) * (340 + 20) + 20\n" +
	"   - Group height = ceil(unitCount / 3) * (200 + 20) + 60 (label + padding)\n" +
	'4. **Summary node** at bottom: color `"6"`, width 700, height 160\n' +
	"5. **Edges**: connect each group to the next group (top-down flow):\n" +
	'   - `fromSide: "bottom"`, `toSide: "top"`, `toEnd: "arrow"`\n' +
	"   Also add dependency edges between unit nodes across layers:\n" +
	'   - `fromSide: "bottom"`, `toSide: "top"`, `toEnd: "arrow"`, `color: "3"`\n\n' +
	"## Coordinate Math\n" +
	"- Start title at x=0, y=0\n" +
	"- First group at y = title.height + 60\n" +
	"- Each subsequent group at y = previousGroup.y + previousGroup.height + 60\n" +
	"- Child nodes inside group: x = group.x + 20, y = group.y + 40 (clear label)\n" +
	"- Column offset: col * (340 + 20)\n" +
	"- Row offset: row * (200 + 20)\n\n" +
	"## Instructions\n" +
	"1. Parse all layers and units from the task tree\n" +
	"2. Calculate layout coordinates using the math above\n" +
	"3. Write the canvas file using the write tool to `backlog.canvas`\n" +
	"4. Run the validator: `bun /Users/pierre-mikel/.pi/agent/skills/json-canvas/scripts/validate-canvas.ts backlog.canvas`\n" +
	"5. If the validator reports errors (exit 1), fix them and re-write\n" +
	"6. Output the path to the canvas file and a brief summary\n\n" +
	"IMPORTANT: Ensure all child nodes are fully contained within their group bounds. " +
	"Ensure no nodes overlap. Double-check coordinates before writing.";

/** Stage 7: Render the task tree as a visual Obsidian canvas */
const renderCanvas: Step = {
	kind: "step",
	label: "Render Canvas",
	agent: "canvas-renderer",
	description:
		"Convert the layered task tree into a backlog.canvas file for Obsidian",
	prompt: CANVAS_PROMPT,
	gate: command(
		"bun /Users/pierre-mikel/.pi/agent/skills/json-canvas/scripts/validate-canvas.ts backlog.canvas",
	),
	onFail: retry(3), // validator caught errors → fix and rewrite
	transform: { kind: "full" },
};

// ── Pipeline Spec ────────────────────────────────────────────────────────

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		captureAndClarify, // 1️⃣ Raw requirement → structured spec
		decompose, // 2️⃣ Spec → atomic units with dependencies
		shrinkAndScore, // 3️⃣ Score & re-split until composite ≤ 2
		validate, // 4️⃣ Flash dry-run — proves units are executable
		resolveDependencies, // 5️⃣ Adjacency graph → cycle check → topological sort → layers
		formatTree, // 6️⃣ Output final layered task tree
		renderCanvas, // 7️⃣ Render backlog.canvas for Obsidian
	],
};
