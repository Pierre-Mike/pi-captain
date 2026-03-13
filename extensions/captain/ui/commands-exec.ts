// ── ui/commands-exec.ts — Execution helpers for slash commands ─────────────
// Extracted from commands.ts to stay within 200-line limit (Basic_knowledge.md).
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { PipelineState, Runnable } from "../core/types.js";
import type { ExecutorContext } from "../shell/executor.js";
import { executeRunnable } from "../shell/executor.js";
import type { CaptainJob, CaptainState } from "../state.js";
import { ensurePipelineLoaded } from "./commands-parse.js";
import { clearWidget, updateWidget } from "./widget.js";

export async function buildEctx(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	_state: CaptainState,
	stateName: string,
	pipelineState: PipelineState,
	signal?: AbortSignal,
): Promise<ExecutorContext | undefined> {
	const model = ctx.model;
	if (!model) {
		ctx.ui.notify("No model available.", "error");
		return undefined;
	}
	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!apiKey) {
		ctx.ui.notify("No API key available for the current model.", "error");
		return undefined;
	}
	return {
		exec: (cmd, execArgs, opts) => pi.exec(cmd, [...execArgs], opts),
		model,
		modelRegistry: ctx.modelRegistry,
		apiKey,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
		signal,
		pipelineName: stateName,
		onStepStart: (label) => {
			pipelineState.currentSteps.add(label);
			pipelineState.currentStepStreams.delete(label);
			updateWidget(ctx, pipelineState);
		},
		onStepStream: (label, text) => {
			pipelineState.currentStepStreams.set(label, text);
			updateWidget(ctx, pipelineState);
		},
		onStepEnd: (result) => {
			pipelineState.currentSteps.delete(result.label);
			pipelineState.currentStepStreams.delete(result.label);
			pipelineState.results.push(result);
			updateWidget(ctx, pipelineState);
		},
	};
}

/** Run a runnable spec directly from a slash command */
export async function runRunnableFromCommand(
	pi: ExtensionAPI,
	spec: Runnable,
	input: string,
	pipelineState: PipelineState,
	job: CaptainJob,
	state: CaptainState,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const ectx = await buildEctx(
		pi,
		ctx,
		state,
		pipelineState.name,
		pipelineState,
		job.controller.signal,
	);
	if (!ectx) return;

	try {
		const { output, results } = await executeRunnable(spec, input, input, ectx);
		pipelineState.endTime = Date.now();
		clearWidget(ctx, pipelineState);
		if (pipelineState.status === "cancelled") {
			ctx.ui.notify(
				`✗ "${pipelineState.name}" (job #${pipelineState.jobId}) was killed.`,
				"error",
			);
			return;
		}
		pipelineState.status = "completed";
		pipelineState.finalOutput = output;
		pipelineState.results = results;
		const elapsed = (
			(pipelineState.endTime -
				(pipelineState.startTime ?? pipelineState.endTime)) /
			1000
		).toFixed(1);
		const passed = results.filter((r) => r.status === "passed").length;
		const failed = results.filter((r) => r.status === "failed").length;
		ctx.ui.notify(
			`✓ "${pipelineState.name}" completed in ${elapsed}s — ${passed} passed, ${failed} failed\n\n${output.slice(0, 800)}${output.length > 800 ? "\n…(truncated)" : ""}`,
			failed > 0 ? "error" : "info",
		);
	} catch (err) {
		pipelineState.endTime = Date.now();
		clearWidget(ctx, pipelineState);
		const wasCancelled = pipelineState.status === "cancelled";
		if (!wasCancelled) pipelineState.status = "failed";
		ctx.ui.notify(
			wasCancelled
				? `✗ "${pipelineState.name}" (job #${pipelineState.jobId}) was killed.`
				: `✗ "${pipelineState.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

export async function runInteractivePipelineLauncher(
	pi: ExtensionAPI,
	state: CaptainState,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const presets = state.discoverPresets(ctx.cwd);
	const allNames = [
		...new Set([
			...Object.keys(state.pipelines),
			...presets.map((p) => p.name),
		]),
	];

	if (allNames.length === 0) {
		ctx.ui.notify(
			"No pipelines defined or available. Place .ts files in .pi/pipelines/ or pass a file path to /captain.",
			"info",
		);
		return;
	}

	const selected = await ctx.ui.select("Select a pipeline:", allNames);
	if (!selected) return;

	const input = await ctx.ui.input(`Input for "${selected}":`, "");
	if (input === undefined) return;
	if (!input.trim()) {
		ctx.ui.notify("No input provided.", "error");
		return;
	}

	if (
		!(await ensurePipelineLoaded(selected, ctx.cwd, state, (msg, level) =>
			ctx.ui.notify(msg, level),
		))
	)
		return;

	const spec = state.pipelines[selected].spec;
	const pipelineState: PipelineState = {
		name: selected,
		spec,
		status: "running",
		results: [],
		currentSteps: new Set(),
		currentStepStreams: new Map(),
		currentStepToolCalls: new Map(),
		startTime: Date.now(),
	};
	const job = state.allocateJob(pipelineState);
	updateWidget(ctx, pipelineState);
	// Fire-and-forget: return immediately so the user can keep chatting.
	// The widget shows live progress; ctx.ui.notify fires on completion/error.
	void runRunnableFromCommand(
		pi,
		spec,
		input.trim(),
		pipelineState,
		job,
		state,
		ctx,
	);
}

// showPipelineDetails lives in commands-details.ts (line-limit)
export { showPipelineDetails } from "./commands-details.js";
