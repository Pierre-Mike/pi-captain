// ── Shared Execution Utilities ─────────────────────────────────────────────
// Common patterns used by executeSequential, executePool, and executeParallel

import { runGate } from "../gates/index.js";
import {
	type ExecutorContext,
	executeStep,
	makeGateCtx,
} from "../steps/runner.js";
import type { Gate, OnFail, StepResult, Transform } from "../types.js";

/**
 * Hard ceiling on retry attempts enforced by the executor, regardless of what
 * the user-supplied onFail function returns. Prevents infinite loops when an
 * inline onFail always returns { action: "retry" } with no exit condition.
 */
const MAX_EXECUTOR_RETRIES = 10;

/**
 * Run a gate check on the output of a composition node (sequential, pool, parallel).
 * Handles all OnFail actions: retry, retryWithDelay, fail, skip, warn, fallback.
 * Used by all three composition execution functions to avoid code duplication.
 */
export async function runContainerGate(
	output: string,
	results: StepResult[],
	gate: Gate | undefined,
	onFail: OnFail | undefined,
	scopeLabel: string,
	rerunFn: () => Promise<{ output: string; results: StepResult[] }>,
	ectx: ExecutorContext,
	retryCount = 0,
): Promise<{ output: string; results: StepResult[] }> {
	if (!gate) return { output, results };

	const gateResult = await runGate(gate, output, makeGateCtx(ectx));

	const gateStepResult: StepResult = {
		label: `[gate] ${scopeLabel}`,
		status: gateResult.passed ? "passed" : "failed",
		output: gateResult.reason,
		gateResult,
		elapsed: 0,
	};
	ectx.onStepEnd?.(gateStepResult);

	if (gateResult.passed)
		return { output, results: [...results, gateStepResult] };
	if (!onFail) return { output, results: [...results, gateStepResult] };

	const decision = await onFail({
		reason: gateResult.reason,
		retryCount,
		stepCount: retryCount + 1,
		output,
	});

	switch (decision.action) {
		case "retry": {
			if (retryCount >= MAX_EXECUTOR_RETRIES) {
				gateStepResult.status = "failed";
				gateStepResult.error = `Gate failed after ${MAX_EXECUTOR_RETRIES} retries (executor hard cap): ${gateResult.reason}`;
				console.warn(
					`[captain] runContainerGate: hard retry cap (${MAX_EXECUTOR_RETRIES}) reached for "${scopeLabel}". Forcing fail.`,
				);
				return { output, results: [...results, gateStepResult] };
			}
			const retried = await rerunFn();
			return runContainerGate(
				retried.output,
				retried.results,
				gate,
				onFail,
				scopeLabel,
				rerunFn,
				ectx,
				retryCount + 1,
			);
		}

		case "fail":
			gateStepResult.error = `Gate failed: ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "skip":
			gateStepResult.status = "skipped";
			gateStepResult.error = `Skipped: ${gateResult.reason}`;
			return { output: "", results: [...results, gateStepResult] };

		case "warn":
			gateStepResult.status = "passed";
			gateStepResult.error = `⚠️ Warning (gate failed but continued): ${gateResult.reason}`;
			return { output, results: [...results, gateStepResult] };

		case "fallback": {
			const fallbackResult = await executeStep(
				{ ...decision.step, kind: "step" },
				output,
				output,
				ectx,
			);
			return {
				output: fallbackResult.output,
				results: [...results, gateStepResult, ...fallbackResult.results],
			};
		}

		default:
			return { output, results: [...results, gateStepResult] };
	}
}

/**
 * Apply a transform function to output text.
 * Common pattern used by all composition types.
 */
export async function applyTransform(
	transform: Transform | undefined,
	output: string,
	ectx: ExecutorContext,
	original = "",
): Promise<string> {
	if (!transform) return output;

	return transform({ output, original, ctx: makeGateCtx(ectx) });
}
