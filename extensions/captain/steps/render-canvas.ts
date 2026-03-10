// ── Step: Render Canvas ──────────────────────────────────────────────────
// Stage 8 of shredder: Convert the task tree into a visual Obsidian
// backlog.canvas file with layered groups, unit nodes, and dependency edges.

import os from "node:os";
import path from "node:path";
import { command, retry } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const piHome = process.env.PI_HOME ?? path.join(os.homedir(), ".pi");
const canvasValidator = path.join(
	piHome,
	"agent/skills/json-canvas/scripts/validate-canvas.ts",
);

const CANVAS_PROMPT = `
You are the Canvas Renderer. Convert the task tree into a JSON Canvas file named backlog.canvas.

Task tree:
$INPUT

Original requirement:
$ORIGINAL

## JSON Canvas Format Rules

The canvas is JSON with two arrays: \`nodes\` and \`edges\`.
Node types: \`text\` (markdown content), \`group\` (visual container with \`label\`).
Every element needs a unique \`id\` — use 16-char hex strings for nodes, \`edge-NNN\` for edges.
Property order: \`type\`, \`id\`, \`x\`, \`y\`, \`width\`, \`height\`, then optional fields (\`color\`, \`text\`, \`label\`).

## Color Scheme
- \`"1"\` (red) = title/header node
- \`"4"\` (green) = parallel layer groups
- \`"5"\` (purple) = sequential layer groups
- \`"6"\` (cyan) = summary node
- No color = unit text nodes (default canvas color)

## Layout Strategy — Top-Down Layer Flow

1. **Title node** at top: the requirement title, color \`"1"\`, width 700, height 120
2. **One group node per execution layer**, stacked vertically with 60px gaps between groups
   - Group label = \`"Layer N (parallel)"\` or \`"Layer N (sequential)"\`
   - Group color = \`"4"\` for parallel, \`"5"\` for sequential
3. **Text nodes inside each group** — one per unit, arranged in a grid:
   - Max 3 columns, each unit node width = 340, height = 200
   - 20px padding from group edges, 20px gap between unit nodes
   - Unit text format: \`## UNIT-N: name\\n\\n**Score:** X\\n**Goal:** ...\\n**Test:** ...\`
   - Group width = min(unitCount, 3) * (340 + 20) + 20
   - Group height = ceil(unitCount / 3) * (200 + 20) + 60 (label + padding)
4. **Summary node** at bottom: color \`"6"\`, width 700, height 160
5. **Edges**: connect each group to the next group (top-down flow):
   - \`fromSide: "bottom"\`, \`toSide: "top"\`, \`toEnd: "arrow"\`
   Also add dependency edges between unit nodes across layers:
   - \`fromSide: "bottom"\`, \`toSide: "top"\`, \`toEnd: "arrow"\`, \`color: "3"\`

## Coordinate Math
- Start title at x=0, y=0
- First group at y = title.height + 60
- Each subsequent group at y = previousGroup.y + previousGroup.height + 60
- Child nodes inside group: x = group.x + 20, y = group.y + 40 (clear label)
- Column offset: col * (340 + 20)
- Row offset: row * (200 + 20)

## Instructions
1. Parse all layers and units from the task tree
2. Calculate layout coordinates using the math above
3. Write the canvas file using the write tool to \`backlog.canvas\`
4. Run the validator: \`bun ${canvasValidator} backlog.canvas\`
5. If the validator reports errors (exit 1), fix them and re-write
6. Output the path to the canvas file and a brief summary

IMPORTANT: Ensure all child nodes are fully contained within their group bounds.
Ensure no nodes overlap. Double-check coordinates before writing.
`;

export const renderCanvas: Step = {
	kind: "step",
	label: "Render Canvas",
	tools: ["read", "bash", "write"],
	model: "sonnet",
	temperature: 0,
	description:
		"Convert the layered task tree into a backlog.canvas file for Obsidian",
	prompt: CANVAS_PROMPT,
	gate: command(`bun ${canvasValidator} backlog.canvas`),
	onFail: retry(),
	transform: full,
};
