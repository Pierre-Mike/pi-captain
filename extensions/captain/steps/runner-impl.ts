// ── steps/runner-impl.ts — runPrompt helper ──────────────────────────────
// handleFailure lives in failure-handler.ts to stay within 200 lines.
import { appendFileSync } from "node:fs";
import type { Step } from "../core/types.js";
import type { ExecutorContext } from "./executor-context.js";
import type { AgentSession } from "./session.js";

export { handleFailure } from "./failure-handler.js";

export const _captainDebug = (msg: string) => {
	if (process.env.CAPTAIN_DEBUG) appendFileSync("/tmp/captain-debug.log", msg);
};

// ── Core prompt execution ─────────────────────────────────────────────────

export async function runPrompt(
	session: AgentSession,
	prompt: string,
	step: Step,
	ectx: ExecutorContext,
	disposeAfter = true,
	stepInput = "",
	original = "",
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
			const toolStartCtx = {
				label: step.label,
				input: stepInput,
				original,
				toolName: event.toolName as string,
				toolInput: event.toolInput as unknown,
			};
			void step.hooks?.onToolCallStart?.(toolStartCtx);
			void ectx.onToolCallStart?.(toolStartCtx);
		} else if (event.type === "tool_execution_end") {
			toolCallCount++;
			ectx.onStepToolCall?.(step.label, toolCallCount);
			const toolEndCtx = {
				label: step.label,
				input: stepInput,
				original,
				toolName: event.toolName as string,
				toolInput: event.toolInput as unknown,
				output: event.result as unknown,
				isError: event.isError as boolean,
			};
			void step.hooks?.onToolCallEnd?.(toolEndCtx);
			void ectx.onToolCallEnd?.(toolEndCtx);
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

	if (disposeAfter) await session.dispose();
	return { output, toolCallCount };
}
