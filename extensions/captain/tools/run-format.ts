// ── tools/run-format.ts — Output formatting, step hook builders, and logging ──
// Extracted from run-helpers.ts to stay within 200-line limit.

import { appendFileSync, mkdirSync } from "node:fs";
import * as path from "node:path";
import * as piSdk from "@mariozechner/pi-coding-agent";
import type { PipelineState, StepResult } from "../core/types.js";
import type { ExecutorContext } from "../shell/executor.js";
import type { ExecCtx } from "./run-helpers.js";

/** Build the lifecycle hooks that update the pipeline widget on each step event. */
export function makeStepHooks(
	pipelineState: PipelineState,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
): Pick<
	ExecutorContext,
	"onStepStart" | "onStepStream" | "onStepEnd" | "onStepToolCall"
> {
	return {
		onStepStart: (label) => {
			pipelineState.currentSteps.add(label);
			pipelineState.currentStepStreams.delete(label);
			pipelineState.currentStepToolCalls.delete(label);
			updateWidget(ctx, pipelineState);
		},
		onStepStream: (label, streamText) => {
			pipelineState.currentStepStreams.set(label, streamText);
			updateWidget(ctx, pipelineState);
		},
		onStepToolCall: (label, totalCalls) => {
			pipelineState.currentStepToolCalls.set(label, totalCalls);
			updateWidget(ctx, pipelineState);
		},
		onStepEnd: (result: StepResult) => {
			pipelineState.currentSteps.delete(result.label);
			pipelineState.currentStepStreams.delete(result.label);
			pipelineState.currentStepToolCalls.delete(result.label);
			pipelineState.results.push(result);
			updateWidget(ctx, pipelineState);
		},
	};
}

// ── Pipeline log writer ───────────────────────────────────────────────────
/** Write a structured log for every pipeline run to .pi/logs/<ts>-<name>.log */
export function writePipelineLog(cwd: string, state: PipelineState): void {
	try {
		const logDir = path.join(cwd, ".pi", "logs");
		mkdirSync(logDir, { recursive: true });
		const ts = new Date().toISOString().replace(/[:.]/g, "-");
		const logPath = path.join(logDir, `${ts}-${state.name}.log`);
		const lines: string[] = [
			`Pipeline: ${state.name}  status: ${state.status}`,
			`Job #${state.jobId ?? "?"}`,
			`Started: ${state.startTime ? new Date(state.startTime).toISOString() : "?"}`,
			`Ended:   ${state.endTime ? new Date(state.endTime).toISOString() : "?"}`,
			"",
			"── Steps ──",
		];
		for (const r of state.results) {
			const gate = r.gateResult
				? ` [gate: ${r.gateResult.passed ? "pass" : `FAIL — ${r.gateResult.reason}`}]`
				: "";
			lines.push(
				`${r.status.padEnd(8)} ${r.label} (${(r.elapsed / 1000).toFixed(1)}s)${gate}`,
			);
			if (r.error) lines.push(`         error: ${r.error}`);
			if (r.output.trim()) lines.push(`         output:\n${r.output.trim()}\n`);
		}
		if (state.finalOutput)
			lines.push("", "── Final Output ──", state.finalOutput);
		appendFileSync(logPath, `${lines.join("\n")}\n`);
		// biome-ignore lint/suspicious/noConsole: intentional — surface log path in terminal
		console.error(`[captain] log: ${logPath}`);
	} catch {
		/* best-effort — never crash the pipeline over logging */
	}
}

// ── Output formatter ─────────────────────────────────────────────────────
export function buildCompletionText(
	name: string,
	output: string,
	results: StepResult[],
	startTime: number | undefined,
	endTime: number | undefined,
): string {
	const end = endTime ?? Date.now();
	const elapsed = ((end - (startTime ?? end)) / 1000).toFixed(1);
	const passed = results.filter((r) => r.status === "passed").length;
	const failed = results.filter((r) => r.status === "failed").length;
	const skipped = results.filter((r) => r.status === "skipped").length;
	const { content: truncated } = piSdk.truncateHead(output, {
		maxLines: piSdk.DEFAULT_MAX_LINES,
		maxBytes: piSdk.DEFAULT_MAX_BYTES,
	});
	return [
		`Pipeline "${name}" completed in ${elapsed}s`,
		`Steps: ${results.length} (${passed} passed, ${failed} failed, ${skipped} skipped)`,
		"── Output ──",
		truncated,
	].join("\n");
}
