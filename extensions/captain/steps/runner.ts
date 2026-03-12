// ── steps/runner.ts — Step execution coordinator (shell layer) ────────────
// Coordinates session creation (session.ts), gate evaluation, and failure
// handling. Private helpers live in runner-impl.ts to stay ≤ 200 lines.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { GateCtx, Step, StepResult, Transform } from "../core/types.js";
import { resolveModel } from "../core/utils/model.js";
import { runGate } from "../gates/index.js";
import { _captainDebug, handleFailure, runPrompt } from "./runner-impl.js";
import {
	type AgentSession,
	createStepSession,
	isSessionCompatible,
	type WarmSession,
} from "./session.js";

export type { WarmSession };
export type { ExecutorContext } from "./executor-context.js";
export { createPipelineSession, isSessionCompatible } from "./session.js";

import type { ExecutorContext } from "./executor-context.js";

// ── Public API ─────────────────────────────────────────────────────────────

/** Build a GateCtx from an ExecutorContext. */
export function makeGateCtx(ectx: ExecutorContext): GateCtx {
	return {
		cwd: ectx.cwd,
		signal: ectx.signal,
		exec: ectx.exec,
		confirm: ectx.confirm,
		hasUI: ectx.hasUI,
		model: ectx.model,
		apiKey: ectx.apiKey,
		modelRegistry: ectx.modelRegistry,
	};
}

/** Apply a transform function to step output. */
export async function applyStepTransform(
	transform: Transform | undefined,
	output: string,
	ectx: ExecutorContext,
	original = "",
): Promise<string> {
	if (!transform) return output;
	return transform({ output, original, ctx: makeGateCtx(ectx) });
}

/** Resolve which AgentSession to use for a step and whether to dispose it after. */
async function resolveSession(
	step: Step,
	ectx: ExecutorContext,
	resolvedModel: Model<Api>,
	warmSession: WarmSession | null | undefined,
	useShared: boolean,
): Promise<{ session: AgentSession; disposeAfter: boolean }> {
	if (useShared && ectx.sharedSession) {
		const session = ectx.sharedSession.session;
		session.newSession();
		if (step.model) await session.setModel(resolvedModel);
		return { session, disposeAfter: false };
	}
	const session =
		warmSession?.session ??
		(await createStepSession(step, ectx, resolvedModel));
	return { session, disposeAfter: true };
}

/**
 * Execute a single step — entry point for all step execution.
 * Coordinates session creation, prompt execution, gate evaluation, and failure handling.
 *
 * Session priority:
 *  1. `ectx.sharedSession` when the step is loader-compatible (sequential fast path)
 *  2. `warmSession` argument (kept for parallel/pool callers that pre-warm per-step)
 *  3. Cold `createStepSession` as final fallback
 */
export async function executeStep(
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
	warmSession?: WarmSession | null,
): Promise<{ output: string; results: StepResult[] }> {
	const start = Date.now();
	ectx.onStepStart?.(step.label);

	// Determine whether the pipeline-level shared session can serve this step.
	const useShared =
		ectx.sharedSession !== undefined && isSessionCompatible(step);

	const resolvedModel: Model<Api> = step.model
		? resolveModel(step.model, ectx.modelRegistry, ectx.model)
		: (warmSession?.resolvedModel ?? ectx.model);

	const result: StepResult = {
		label: step.label,
		status: "running",
		output: "",
		elapsed: 0,
		toolCount: (step.tools ?? ["read", "bash", "edit", "write"]).length,
		toolCallCount: 0,
		model: resolvedModel.id,
	};

	try {
		const { session, disposeAfter } = await resolveSession(
			step,
			ectx,
			resolvedModel,
			warmSession,
			useShared,
		);

		const interpolated = step.prompt
			.replace(/\$INPUT/g, input)
			.replace(/\$ORIGINAL/g, original);
		const { output, toolCallCount } = await runPrompt(
			session,
			interpolated,
			step,
			ectx,
			disposeAfter,
		);

		const gateCtx = makeGateCtx(ectx);
		const gateResult = step.gate
			? await runGate(step.gate, output, gateCtx)
			: { passed: true, reason: "No gate" };

		if (!gateResult.passed) {
			const failResult = await handleFailure(
				step,
				input,
				original,
				output,
				gateResult,
				ectx,
				0,
				gateCtx,
				executeStep,
			);
			result.status = failResult.status;
			result.output = failResult.output;
			result.error = failResult.error;
			result.gateResult = gateResult;
		} else {
			result.status = "passed";
			result.output = output;
			result.gateResult = gateResult;
		}
		result.toolCallCount = toolCallCount;
	} catch (err) {
		result.status = "failed";
		result.error = err instanceof Error ? err.message : String(err);
		result.output = `Error: ${result.error}`;
	}

	result.elapsed = Date.now() - start;
	if (ectx.stepGroup) result.group = ectx.stepGroup;
	ectx.onStepEnd?.(result);

	const transformedOutput = await applyStepTransform(
		step.transform,
		result.output,
		ectx,
		original,
	);
	return { output: transformedOutput, results: [result] };
}

// Re-export for debugging
export { _captainDebug };
