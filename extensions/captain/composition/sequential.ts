// ── Sequential Pipeline Execution ─────────────────────────────────────────
// Steps run one after another, with output of each feeding into the next

import { applyTransform, runContainerGate } from "../shell/execution.js";
import {
	type ExecutorContext,
	executeStep,
	prefetchSession,
	type WarmSession,
} from "../steps/runner.js";
import type { Runnable, Sequential, StepResult } from "../types.js";

/**
 * Execute a sequential pipeline with 1-step lookahead prefetch optimization.
 * While step[i]'s prompt is running (blocking on the LLM), we fire off
 * createAgentSession for step[i+1] in the background. By the time step[i]
 * finishes and we know $INPUT, the session for step[i+1] is already warm.
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

	// Kick off a background session creation for `step`, or return null if
	// the step isn't a plain Step (nested sequential/pool/parallel).
	const startPrefetch = (runnable: Runnable): Promise<WarmSession | null> =>
		runnable.kind === "step"
			? prefetchSession(runnable, ectx)
			: Promise.resolve(null);

	// Pre-warm the session for the very first step immediately.
	let nextPrefetch: Promise<WarmSession | null> =
		seq.steps.length > 0 ? startPrefetch(seq.steps[0]) : Promise.resolve(null);

	for (let i = 0; i < seq.steps.length; i++) {
		if (ectx.signal?.aborted) {
			// Pipeline cancelled — dispose any pending prefetch to avoid leaking sessions.
			nextPrefetch
				.then((w) => w?.session.dispose())
				.catch((_e: unknown) => {
					/* best-effort dispose — ignore errors */
				});
			break;
		}

		const runnable = seq.steps[i];

		// Await the pre-warmed session for THIS step (created during the previous step).
		const warm = await nextPrefetch;

		// Immediately kick off prefetch for the NEXT step — runs concurrently
		// with this step's LLM call, which is the long part.
		nextPrefetch =
			i + 1 < seq.steps.length
				? startPrefetch(seq.steps[i + 1])
				: Promise.resolve(null);

		// Run the current step, handing it the warm session.
		const { output, results } =
			runnable.kind === "step"
				? await executeStep(runnable, currentInput, original, ectx, warm)
				: await executeRunnable(runnable, currentInput, original, ectx);
		// ↑ warm session is unused for nested runnables; it was null anyway.

		allResults.push(...results);
		currentInput = output;

		const lastResult = results.at(-1);
		if (lastResult?.status === "failed") {
			// Step failed — dispose any pending prefetch before bailing.
			nextPrefetch
				.then((w) => w?.session.dispose())
				.catch((_e: unknown) => {
					/* best-effort dispose — ignore errors */
				});
			break;
		}
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
