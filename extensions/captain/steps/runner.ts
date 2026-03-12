// ── steps/runner.ts — Step execution coordinator (shell layer) ────────────
// Coordinates session creation (session.ts), gate evaluation, and failure
// handling. Private helpers live in runner-impl.ts to stay ≤ 200 lines.

import type { Api, Model } from "@mariozechner/pi-ai";
import { runGate } from "../gates/index.js";
import type { GateCtx, Step, StepResult, Transform } from "../types.js";
import { resolveModel } from "../utils/model.js";
import { _captainDebug, handleFailure, runPrompt } from "./runner-impl.js";
import {
	type AgentSession,
	createStepSession,
	type WarmSession,
} from "./session.js";

export type { WarmSession };
export type { ExecutorContext } from "./executor-context.js";
export { prefetchSession } from "./session.js";

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

/**
 * Execute a single step — entry point for all step execution.
 * Coordinates session creation, prompt execution, gate evaluation, and failure handling.
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

	const resolvedModel: Model<Api> =
		warmSession?.resolvedModel ??
		(step.model
			? resolveModel(step.model, ectx.modelRegistry, ectx.model)
			: ectx.model);

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
		const session =
			warmSession?.session ??
			(await createStepSession(step, ectx, resolvedModel));
		const interpolated = step.prompt
			.replace(/\$INPUT/g, input)
			.replace(/\$ORIGINAL/g, original);
		const { output, toolCallCount } = await runPrompt(
			session as AgentSession,
			interpolated,
			step,
			ectx,
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
