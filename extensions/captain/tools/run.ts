import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as piSdk from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { CaptainDetails, PipelineState, StepResult } from "../types.js";
import {
	buildPipelineSelectOptions,
	parsePipelineSelectOption,
} from "../ui/select.js";
import { statusIcon } from "../utils/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompletionSummary(
	name: string,
	output: string,
	results: StepResult[],
	startTime: number | undefined,
	endTime: number,
): string {
	const elapsed = ((endTime - (startTime ?? endTime)) / 1000).toFixed(1);
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
		"",
		"── Output ──",
		truncated,
	].join("\n");
}

// ── Return shape for the interactive guard ────────────────────────────────────
type GuardResult = {
	done: true;
	result: { content: Array<{ type: string; text: string }>; isError: boolean };
};
type SelectCtx = {
	hasUI: boolean;
	ui: {
		select: (t: string, o: string[]) => Promise<string | undefined>;
		input: (t: string, p: string) => Promise<string | undefined>;
	};
};

function cancelled(): GuardResult {
	return {
		done: true,
		result: {
			content: [{ type: "text", text: "(cancelled)" }],
			isError: false,
		},
	};
}
function guardError(msg: string): GuardResult {
	return {
		done: true,
		result: { content: [{ type: "text", text: msg }], isError: true },
	};
}

/** Show the pipeline dropdown and auto-load a builtin preset if needed.
 *  Returns the selected pipeline name, or a GuardResult to surface early. */
async function selectAndAutoLoad(
	state: CaptainState,
	ctx: SelectCtx,
): Promise<string | GuardResult> {
	const options = buildPipelineSelectOptions(state);
	if (options.length === 0) {
		return {
			done: true,
			result: {
				content: [
					{
						type: "text",
						text: "No pipelines available. Use captain_define or captain_load first.",
					},
				],
				isError: false,
			},
		};
	}
	let selectedOption: string | undefined;
	try {
		selectedOption = await ctx.ui.select("Select a pipeline", options);
	} catch (err) {
		return guardError(err instanceof Error ? err.message : String(err));
	}
	if (selectedOption === undefined) return cancelled();

	const name = parsePipelineSelectOption(selectedOption);
	if (!state.pipelines[name]) {
		try {
			state.resolvePreset(name);
		} catch (err) {
			return guardError(err instanceof Error ? err.message : String(err));
		}
	}
	return name;
}

/**
 * When no pipeline name is supplied, show a select dropdown + input dialog so
 * the user can pick interactively. Always returns a GuardResult (done=true)
 * so the framework re-issues captain_run with the resolved name and input.
 */
async function resolveNameInteractively(
	state: CaptainState,
	hasInput: boolean,
	signal: AbortSignal | undefined,
	ctx: SelectCtx,
): Promise<GuardResult> {
	if (signal?.aborted) return cancelled();
	if (!ctx.hasUI)
		return guardError(
			'Error: pipeline "" not found. Define it first with captain_define.',
		);

	const selected = await selectAndAutoLoad(state, ctx);
	if (typeof selected !== "string") return selected;

	if (!hasInput) {
		try {
			await ctx.ui.input("Input for pipeline", "");
		} catch (err) {
			return guardError(err instanceof Error ? err.message : String(err));
		}
	}

	// UI-initiated selection always returns cancelled to let the framework
	// re-issue captain_run(name=<selected>, input=<user value>).
	return cancelled();
}

type ExecCtx = Parameters<
	Parameters<ExtensionAPI["registerTool"]>[0]["execute"]
>[4];
type OnUpdate = Parameters<
	Parameters<ExtensionAPI["registerTool"]>[0]["execute"]
>[3];

/** Build the three step-lifecycle hooks that drive widget and stream updates. */
function makeStepHooks(
	pipelineState: PipelineState,
	resolvedName: string,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	onUpdate: OnUpdate,
): Pick<ExecutorContext, "onStepStart" | "onStepStream" | "onStepEnd"> {
	return {
		onStepStart: (label) => {
			pipelineState.currentSteps.add(label);
			pipelineState.currentStepStreams.delete(label);
			updateWidget(ctx, pipelineState);
			onUpdate?.({
				content: [{ type: "text", text: `⏳ Running step: ${label}...` }],
			});
			const running = [...pipelineState.currentSteps].join(", ");
			ctx.ui.setStatus("captain", `🚀 ${resolvedName} → ${running}`);
		},
		onStepStream: (label, text) => {
			pipelineState.currentStepStreams.set(label, text);
			updateWidget(ctx, pipelineState);
		},
		onStepEnd: (result: StepResult) => {
			pipelineState.currentSteps.delete(result.label);
			pipelineState.currentStepStreams.delete(result.label);
			pipelineState.results.push(result);
			updateWidget(ctx, pipelineState);
			onUpdate?.({
				content: [
					{
						type: "text",
						text: `${statusIcon(result.status)} ${result.label}: ${result.status} (${(result.elapsed / 1000).toFixed(1)}s)`,
					},
				],
			});
		},
	};
}

/** Assemble the ExecutorContext for a pipeline run. */
function buildEctx(
	pi: ExtensionAPI,
	state: CaptainState,
	pipelineState: PipelineState,
	resolvedName: string,
	apiKey: string,
	signal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	onUpdate: OnUpdate,
): ExecutorContext {
	return {
		exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
		agents: state.agents,
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		apiKey,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
		signal: signal ?? undefined,
		pipelineName: resolvedName,
		...makeStepHooks(pipelineState, resolvedName, ctx, updateWidget, onUpdate),
	};
}

async function runPipeline(
	pi: ExtensionAPI,
	state: CaptainState,
	resolvedName: string,
	resolvedInput: string | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdate,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx) => void,
): Promise<{
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
	details?: unknown;
}> {
	const pipeline = state.pipelines[resolvedName];
	if (!pipeline) {
		return {
			content: [
				{
					type: "text",
					text: `Error: pipeline "${resolvedName}" not found. Define it first with captain_define.`,
				},
			],
			isError: true,
		};
	}

	const pipelineState: PipelineState = {
		name: resolvedName,
		spec: pipeline.spec,
		status: "running",
		results: [],
		currentSteps: new Set(),
		currentStepStreams: new Map(),
		startTime: Date.now(),
	};
	state.runningState = pipelineState;
	updateWidget(ctx, pipelineState);

	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey) {
		return {
			content: [
				{
					type: "text",
					text: "Error: no API key available for the current model",
				},
			],
			isError: true,
		};
	}

	state.loadMdAgents(ctx.cwd);
	const inputStr = resolvedInput ?? "";
	const ectx = buildEctx(
		pi,
		state,
		pipelineState,
		resolvedName,
		apiKey,
		signal,
		ctx,
		updateWidget,
		onUpdate,
	);

	try {
		const { output, results } = await executeRunnable(
			pipeline.spec,
			inputStr,
			inputStr,
			ectx,
		);
		pipelineState.status = "completed";
		pipelineState.finalOutput = output;
		pipelineState.endTime = Date.now();
		pipelineState.results = results;
		ctx.ui.setStatus("captain", undefined);
		clearWidget(ctx);
		return {
			content: [
				{
					type: "text",
					text: buildCompletionSummary(
						resolvedName,
						output,
						results,
						pipelineState.startTime,
						pipelineState.endTime,
					),
				},
			],
			details: state.snapshot(pipelineState),
		};
	} catch (err) {
		pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		ctx.ui.setStatus("captain", undefined);
		clearWidget(ctx);
		const errMsg = err instanceof Error ? err.message : String(err);
		return {
			content: [
				{ type: "text", text: `Pipeline "${resolvedName}" failed: ${errMsg}` },
			],
			details: state.snapshot(pipelineState),
			isError: true,
		};
	}
}

export function registerRunTool(
	pi: ExtensionAPI,
	state: CaptainState,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx) => void,
) {
	pi.registerTool({
		name: "captain_run",
		label: "Captain Run",
		description:
			"Execute a defined captain pipeline. Runs steps according to composition rules (sequential/parallel/pool), manages git worktrees for isolation, chains $INPUT/$ORIGINAL through prompts, evaluates gates, handles failures. Returns final output.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Pipeline name to run" })),
			input: Type.Optional(
				Type.String({
					description:
						"User's original request (becomes $ORIGINAL and initial $INPUT)",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const resolvedInput: string | undefined = params.input;
			const resolvedName: string = params.name || "";

			if (!resolvedName) {
				const guard = await resolveNameInteractively(
					state,
					resolvedInput !== undefined,
					signal,
					ctx,
				);
				if (guard.done) return guard.result;
			}

			return runPipeline(
				pi,
				state,
				resolvedName,
				resolvedInput,
				signal,
				onUpdate,
				ctx,
				updateWidget,
				clearWidget,
			);
		},

		renderCall: (args, theme) => {
			const name = args.name as string | undefined;
			const input = args.input as string | undefined;
			if (!name) {
				return new Text(
					theme.fg("toolTitle", theme.bold("captain_run")) +
						theme.fg("dim", " — select pipeline"),
					0,
					0,
				);
			}
			return new Text(
				theme.fg("toolTitle", theme.bold("captain_run ")) +
					theme.fg("accent", name) +
					theme.fg("dim", " — ") +
					theme.fg(
						"muted",
						`"${(input ?? "").slice(0, 55)}${(input ?? "").length > 55 ? "…" : ""}"`,
					),
				0,
				0,
			);
		},
		renderResult: (result, { isPartial }, theme) => {
			if (isPartial)
				return new Text(theme.fg("accent", "● Running pipeline..."), 0, 0);
			if (result.isError)
				return new Text(theme.fg("error", "✗ Pipeline failed"), 0, 0);
			const d = result.details as CaptainDetails | undefined;
			if (!d?.lastRun) return new Text(theme.fg("success", "✓ Done"), 0, 0);
			const s = d.lastRun.state;
			const elapsed =
				s.endTime && s.startTime
					? ((s.endTime - s.startTime) / 1000).toFixed(1)
					: "?";
			const passed = s.results.filter((r) => r.status === "passed").length;
			const failed = s.results.filter((r) => r.status === "failed").length;
			const skipped = s.results.filter((r) => r.status === "skipped").length;
			return new Text(
				theme.fg("success", `✓ ${s.name}`) +
					theme.fg("dim", ` ${elapsed}s`) +
					theme.fg("dim", "  ") +
					theme.fg("success", `${passed}✓`) +
					(failed > 0 ? theme.fg("error", ` ${failed}✗`) : "") +
					(skipped > 0 ? theme.fg("dim", ` ${skipped}⊘`) : ""),
				0,
				0,
			);
		},
	});
}
