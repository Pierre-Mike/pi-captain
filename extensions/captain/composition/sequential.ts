// ── Sequential Pipeline Execution ─────────────────────────────────────────
// Steps run one after another, with output of each feeding into the next

import type { Runnable, Sequential, StepResult } from "../core/types.js";
import {
	createPipelineSession,
	type ExecutorContext,
	executeStep,
} from "../steps/runner.js";
import { applyTransform, runContainerGate } from "./execution.js";

/**
 * Execute a sequential pipeline using one shared agent session for the run.
 * Compatible steps (no custom systemPrompt / skills / extensions) reuse the
 * pipeline-level session — `session.newSession()` clears history between steps
 * and `session.setModel()` swaps the model when a step overrides it.
 *
 * Steps that require a different loader config fall back automatically to a
 * per-step session inside `executeStep`.
 */
export async function executeSequential(
	seq: Sequential,
	input: string,
	original: string,
	ectx: ExecutorContext,
	executeRunnable: (
		runnable: Runnable,
		input: string,
		original: string,
		ectx: ExecutorContext,
	) => Promise<{ output: string; results: StepResult[] }>,
): Promise<{ output: string; results: StepResult[] }> {
	let currentInput = input;
	const allResults: StepResult[] = [];

	// Create a single shared session for the whole sequential run and attach it
	// to a local copy of ectx so parallel/pool siblings are unaffected.
	// If session creation fails (e.g. auth error during startup), fall back
	// gracefully to per-step session creation inside executeStep.
	let pipelineSession: Awaited<
		ReturnType<typeof createPipelineSession>
	> | null = null;
	if (seq.steps.length > 0) {
		try {
			pipelineSession = await createPipelineSession(ectx);
		} catch {
			// Best-effort — per-step creation will surface the real error at runtime.
		}
	}
	const localEctx: ExecutorContext = pipelineSession
		? { ...ectx, sharedSession: pipelineSession }
		: ectx;

	try {
		for (const runnable of seq.steps) {
			if (ectx.signal?.aborted) break;

			const { output, results } =
				runnable.kind === "step"
					? await executeStep(runnable, currentInput, original, localEctx)
					: await executeRunnable(runnable, currentInput, original, localEctx);

			allResults.push(...results);
			currentInput = output;

			const lastResult = results.at(-1);
			if (lastResult?.status === "failed") break;
		}
	} finally {
		await pipelineSession?.session.dispose();
	}

	const checked = await runContainerGate(
		currentInput,
		allResults,
		seq.gate,
		seq.onFail,
		`sequential (${seq.steps.length} steps)`,
		() => executeSequential(seq, input, original, ectx, executeRunnable),
		ectx,
		0,
	);

	if (seq.transform) {
		checked.output = await applyTransform(
			seq.transform,
			checked.output,
			ectx,
			original,
		);
	}

	return checked;
}
