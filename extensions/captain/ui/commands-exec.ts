// ── ui/commands-exec.ts — Execution helpers for slash commands ─────────────
// Extracted from commands.ts to stay within 200-line limit (Basic_knowledge.md).
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import { describeRunnable } from "../core/utils/index.js";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { PipelineState, Runnable } from "../types.js";
import { ensurePipelineLoaded } from "./commands-parse.js";
import { clearWidget, updateWidget } from "./widget.js";

export async function buildEctx(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	_state: CaptainState,
	stateName: string,
	pipelineState: PipelineState,
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
	state: CaptainState,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const ectx = await buildEctx(
		pi,
		ctx,
		state,
		pipelineState.name,
		pipelineState,
	);
	if (!ectx) return;

	try {
		const { output, results } = await executeRunnable(spec, input, input, ectx);
		pipelineState.status = "completed";
		pipelineState.finalOutput = output;
		pipelineState.endTime = Date.now();
		pipelineState.results = results;
		clearWidget(ctx);
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
		pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		clearWidget(ctx);
		ctx.ui.notify(
			`✗ "${pipelineState.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
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
			"No pipelines defined or available. Use /captain-load to load a preset.",
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
	state.runningState = pipelineState;
	updateWidget(ctx, pipelineState);
	await runRunnableFromCommand(
		pi,
		spec,
		input.trim(),
		pipelineState,
		state,
		ctx,
	);
}

export async function showPipelineDetails(
	name: string,
	state: CaptainState,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const p = state.pipelines[name];
	if (p) {
		ctx.ui.notify(
			`Pipeline "${name}":\n${describeRunnable(p.spec, 0)}`,
			"info",
		);
		return;
	}
	try {
		const resolved = await state.resolvePreset(name, ctx.cwd);
		if (resolved) {
			ctx.ui.notify(
				`Pipeline "${name}" (${resolved.source ?? "preset"} — not yet loaded):\n${describeRunnable(resolved.spec, 0)}`,
				"info",
			);
			return;
		}
	} catch {
		/* fall through */
	}
	ctx.ui.notify(`Pipeline "${name}" not found.`, "error");
}
