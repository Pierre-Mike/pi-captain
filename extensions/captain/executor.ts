// ── Recursive Pipeline Execution Engine ────────────────────────────────────
// Each Step runs via the pi SDK (createAgentSession) — no subprocess needed.

import { executeParallel } from "./composition/parallel.js";
import { executePool } from "./composition/pool.js";
import { executeSequential } from "./composition/sequential.js";
import {
	type ExecutorContext,
	executeStep,
	type ModelRegistryLike,
} from "./steps/runner.js";
import type { Runnable, StepResult } from "./types.js";

// Re-export interfaces for public API
export type { ExecutorContext, ModelRegistryLike };

/** Execute any Runnable recursively, returning output text */
export async function executeRunnable(
	runnable: Runnable,
	input: string,
	original: string,
	ectx: ExecutorContext,
): Promise<{ output: string; results: StepResult[] }> {
	if (ectx.signal?.aborted) return { output: "(cancelled)", results: [] };

	switch (runnable.kind) {
		case "step":
			return executeStep(runnable, input, original, ectx);
		case "sequential":
			return executeSequential(
				runnable,
				input,
				original,
				ectx,
				executeRunnable,
			);
		case "pool":
			return executePool(runnable, input, original, ectx, executeRunnable);
		case "parallel":
			return executeParallel(runnable, input, original, ectx, executeRunnable);
		default:
			return {
				output: `Unknown runnable kind: ${(runnable as Runnable & { kind: string }).kind}`,
				results: [],
			};
	}
}
