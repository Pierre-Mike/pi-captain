// ── steps/failure-handler.ts — Gate failure resolution ───────────────────
import type { GateCtx, Step } from "../core/types.js";
import { type GateResult, runGate } from "../gates/index.js";
import type { ExecutorContext } from "./executor-context.js";

const MAX_EXECUTOR_RETRIES = 10;

type ExecuteStepFn = (
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
) => Promise<{ output: string }>;

export async function handleFailure(
	step: Step,
	input: string,
	original: string,
	lastOutput: string,
	gateResult: GateResult,
	ectx: ExecutorContext,
	retryCount: number,
	gateCtx: GateCtx,
	executeStepFn: ExecuteStepFn,
): Promise<{
	status: "passed" | "failed" | "skipped";
	output: string;
	error?: string;
}> {
	const onFail = step.onFail;
	if (!onFail)
		return { status: "failed", output: lastOutput, error: gateResult.reason };

	const decision = await onFail({
		reason: gateResult.reason,
		retryCount,
		stepCount: retryCount + 1,
		output: lastOutput,
	});

	switch (decision.action) {
		case "retry": {
			if (retryCount >= MAX_EXECUTOR_RETRIES) {
				return {
					status: "failed",
					output: lastOutput,
					error: `Gate failed after ${MAX_EXECUTOR_RETRIES} retries: ${gateResult.reason}`,
				};
			}
			const retryStep: Step = {
				...step,
				prompt: `${step.prompt}\n\n[RETRY ${retryCount + 1}: ${gateResult.reason}]\n\n${lastOutput.slice(0, 1000)}`,
				gate: undefined,
				onFail: undefined,
			};
			const { output: retryOutput } = await executeStepFn(
				retryStep,
				input,
				original,
				ectx,
			);
			const retryGate = step.gate
				? await runGate(step.gate, retryOutput, gateCtx)
				: { passed: true, reason: "No gate" };
			if (retryGate.passed) return { status: "passed", output: retryOutput };
			return handleFailure(
				step,
				input,
				original,
				retryOutput,
				retryGate,
				ectx,
				retryCount + 1,
				gateCtx,
				executeStepFn,
			);
		}
		case "fail":
			return {
				status: "failed",
				output: lastOutput,
				error: `Gate failed: ${gateResult.reason}`,
			};
		case "skip":
			return {
				status: "skipped",
				output: "",
				error: `Skipped: ${gateResult.reason}`,
			};
		case "warn":
			return {
				status: "passed",
				output: lastOutput,
				error: `⚠️ Warning: ${gateResult.reason}`,
			};
		case "fallback": {
			const { output } = await executeStepFn(
				{ ...decision.step, kind: "step" },
				input,
				original,
				ectx,
			);
			return { status: "passed", output };
		}
		default:
			return { status: "failed", output: lastOutput, error: gateResult.reason };
	}
}
