// ── Pipeline: Shredder ───────────────────────────────────────────────────
// Takes any requirement → clarifies → decomposes → shrinks to Haiku-safe
// units → validates with Flash dry-run → resolves dependency graph into
// parallelizable execution layers → outputs a structured task tree →
// generates an executable pipeline spec → renders a visual backlog.canvas.
// No execution — planning only.
//
// Flow:
//   1. CLARIFY     → clarifier produces a structured spec from raw requirement
//   2. DECOMPOSE   → decomposer splits spec into atomic sub-tasks (pool ×3, ranked)
//   3. SHRED       → shrinker scores complexity, re-splits until Haiku-safe
//   4. VALIDATE    → validator confirms each unit is single-pass executable
//                    (fallback → re-shred failing units)
//   5. RESOLVE     → resolver builds dependency graph, topological sort → layers
//   6. FORMAT      → format layered units into a final task tree
//   7. EXEC SPEC   → generate an executable captain TypeScript pipeline file
//   8. CANVAS      → render backlog.canvas for Obsidian
//
// Preset: captain:shredder (load with: captain_load { action: "load", name: "captain:shredder" })
// Agents: clarifier, decomposer, shrinker, validator, resolver,
//         canvas-renderer (bundled in extensions/captain/agents/)
// Steps:  extensions/captain/steps/{capture-and-clarify,decompose,shred-and-score,
//         re-shred,validate-units,resolve-dependencies,format-tree,
//         generate-execution-spec,render-canvas}.ts

import { rank } from "../../extensions/captain/core/merge.js";
import type { Pool, Runnable } from "../../extensions/captain/types.js";
import { captureAndClarify } from "../steps/capture-and-clarify.js";
import { decompose } from "../steps/decompose.js";
import { formatTree } from "../steps/format-tree.js";
import { generateExecutionSpec } from "../steps/generate-execution-spec.js";
import { renderCanvas } from "../steps/render-canvas.js";
import { resolveDependencies } from "../steps/resolve-dependencies.js";
import { shredAndScore } from "../steps/shred-and-score.js";
import { validateUnits } from "../steps/validate-units.js";

// ── Stage 2: Pool of 3 decomposition attempts — rank best ───────────────

const decomposePool: Pool = {
	kind: "pool",
	step: decompose,
	count: 3,
	merge: rank,
};

// ── Pipeline Spec ────────────────────────────────────────────────────────

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		captureAndClarify, //  1️⃣  CLARIFY   — raw requirement → structured spec
		decomposePool, //  2️⃣  DECOMPOSE — pool ×3 decomposition attempts (ranked)
		shredAndScore, //  3️⃣  SHRED     — score & re-split until composite ≤ 2
		validateUnits, //  4️⃣  VALIDATE  — Flash dry-run (fallback → re-shred)
		resolveDependencies, //  5️⃣  RESOLVE   — adjacency graph → topo sort → layers
		formatTree, //  6️⃣  FORMAT    — output final layered task tree
		generateExecutionSpec, //  7️⃣  EXEC SPEC — task tree → .pi/pipelines/execution-pipeline.ts
		renderCanvas, //  8️⃣  CANVAS    — render backlog.canvas for Obsidian
	],
};
