// ── steps/runner-impl.ts — Private runPrompt & handleFailure helpers ────────
// Extracted from runner.ts to stay within the 200-line limit (Basic_knowledge.md).
import { appendFileSync } from "node:fs";
import { type GateResult, runGate } from "../gates/index.js";
import type { GateCtx, Step } from "../types.js";
import type { ExecutorContext } from "./executor-context.js";
import type { AgentSession } from "./session.js";

const MAX_EXECUTOR_RETRIES = 10;

export const _captainDebug = (msg: string) => {
	if (process.env.CAPTAIN_DEBUG) appendFileSync("/tmp/captain-debug.log", msg);
};

type ExecuteStepFn = (
	step: Step,
	input: string,
	original: string,
	ectx: ExecutorContext,
) => Promise<{ output: string }>;

// ── Core prompt execution ─────────────────────────────────────────────────

export async function runPrompt(
	session: AgentSession,
	prompt: string,
	step: Step,
	ectx: ExecutorContext,
): Promise<{ output: string; toolCallCount: number }> {
	const toolNames = step.tools ?? ["read", "bash", "edit", "write"];
	session.setActiveToolsByName([...toolNames]);

	const onAbort = () => session.abort();
	ectx.signal?.addEventListener("abort", onAbort);

	let output = "";
	let toolCallCount = 0;
	const toolOutputs: string[] = [];
	const toolsUsed: string[] = [];

	// biome-ignore lint/suspicious/noExplicitAny: session event type varies by SDK version
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: sequential event-handler branches
	const unsub = session.subscribe((event: any) => {
		if (
			event.type === "message_update" &&
			event.assistantMessageEvent?.type === "text_delta"
		) {
			output += event.assistantMessageEvent.delta;
			ectx.onStepStream?.(step.label, output);
		} else if (event.type === "tool_execution_start") {
			ectx.onStepStream?.(step.label, output || `[calling ${event.toolName}…]`);
		} else if (event.type === "tool_execution_end") {
			toolCallCount++;
			ectx.onStepToolCall?.(step.label, toolCallCount);
			if (!event.isError) {
				if (!toolsUsed.includes(event.toolName)) toolsUsed.push(event.toolName);
				const text =
					typeof event.result === "string"
						? event.result
						: ((event.result as { output?: string; content?: string })
								?.output ??
							(event.result as { output?: string; content?: string })?.content);
				if (text?.trim())
					toolOutputs.push(`[${event.toolName}]\n${text.trim()}`);
			}
		}
	});

	try {
		await session.prompt(prompt);
	} finally {
		unsub();
		ectx.signal?.removeEventListener("abort", onAbort);
	}

	output = output.trim();
	if (!output) output = session.getLastAssistantText()?.trim() ?? "";
	if (!output && toolOutputs.length > 0) output = toolOutputs.join("\n\n");
	_captainDebug(`[${step.label}] output="${output.slice(0, 100)}"\n`);

	await session.dispose();
	return { output, toolCallCount };
}

// ── Gate + failure handling ───────────────────────────────────────────────

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
				console.warn(`[captain] hard retry cap reached for "${step.label}"`);
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
