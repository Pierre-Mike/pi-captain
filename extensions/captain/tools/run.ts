import type { TextContent } from "@mariozechner/pi-ai";
import type {
	DefaultResourceLoader,
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";
import * as piSdk from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { PipelineState, StepResult } from "../types.js";
import {
	buildPipelineSelectOptions,
	parsePipelineSelectOption,
} from "../ui/select.js";
import { text } from "./helpers.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCompletionText(
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
		"── Output ──",
		truncated,
	].join("\n");
}

// ── Return shape for the interactive guard ────────────────────────────────────
type GuardResult = {
	done: true;
	result: { content: TextContent[]; details: undefined };
};
type SelectCtx = {
	hasUI: boolean;
	cwd: string;
	ui: {
		select: (t: string, o: string[]) => Promise<string | undefined>;
		input: (t: string, p: string) => Promise<string | undefined>;
	};
};

function cancelled(): GuardResult {
	return {
		done: true,
		result: {
			content: [text("(cancelled)")],
			details: undefined,
		},
	};
}
function guardError(msg: string): GuardResult {
	return {
		done: true,
		result: {
			content: [text(msg)],
			details: undefined,
		},
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
					text(
						"No pipelines available. Use captain_define or captain_load first.",
					),
				],
				details: undefined,
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
			state.resolvePreset(name, ctx.cwd);
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
/** Build the three step-lifecycle hooks that drive widget and stream updates. */
function makeStepHooks(
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
		onStepStream: (label, text) => {
			pipelineState.currentStepStreams.set(label, text);
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

/** Assemble the ExecutorContext for a pipeline run. */
function buildEctx(
	pi: ExtensionAPI,
	_state: CaptainState,
	pipelineState: PipelineState,
	resolvedName: string,
	apiKey: string,
	signal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
): ExecutorContext {
	return {
		exec: (cmd, args, opts) => pi.exec(cmd, args, opts),

		// ctx.model is guaranteed non-null — caller guards with !ctx.model before buildEctx
		model: ctx.model as NonNullable<typeof ctx.model>,
		modelRegistry: ctx.modelRegistry,
		apiKey,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
		signal: signal ?? undefined,
		pipelineName: resolvedName,
		// Fix 1: shared loader cache — reused across all steps in this pipeline run.
		loaderCache: new Map<string, DefaultResourceLoader>(),
		...makeStepHooks(pipelineState, ctx, updateWidget),
	};
}

async function runPipeline(
	pi: ExtensionAPI,
	state: CaptainState,
	resolvedName: string,
	resolvedInput: string | undefined,
	signal: AbortSignal | undefined,
	ctx: ExecCtx,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx) => void,
): Promise<{
	content: TextContent[];
	details: undefined;
}> {
	const pipeline = state.pipelines[resolvedName];
	if (!pipeline) {
		return {
			content: [
				text(
					`Error: pipeline "${resolvedName}" not found. Define it first with captain_define.`,
				),
			],
			details: undefined,
		};
	}

	const pipelineState: PipelineState = {
		name: resolvedName,
		spec: pipeline.spec,
		status: "running",
		results: [],
		currentSteps: new Set(),
		currentStepStreams: new Map(),
		currentStepToolCalls: new Map(),
		startTime: Date.now(),
	};
	state.runningState = pipelineState;
	updateWidget(ctx, pipelineState);

	if (!ctx.model) {
		return { content: [text("Error: no model available")], details: undefined };
	}

	const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
	if (!apiKey) {
		return {
			content: [text("Error: no API key available for the current model")],
			details: undefined,
		};
	}

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
		clearWidget(ctx);
		return {
			content: [
				text(
					buildCompletionText(
						resolvedName,
						output,
						results,
						pipelineState.startTime,
						pipelineState.endTime,
					),
				),
			],
			details: undefined,
		};
	} catch (err) {
		pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		clearWidget(ctx);
		const errMsg = err instanceof Error ? err.message : String(err);
		return {
			content: [text(`Pipeline "${resolvedName}" failed: ${errMsg}`)],
			details: undefined,
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

		async execute(_id, params, signal, _onUpdate, ctx) {
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
			const text =
				result.content[0] && "text" in result.content[0]
					? result.content[0].text
					: "";
			if (text.startsWith("Pipeline") && text.includes("failed:"))
				return new Text(theme.fg("error", "✗ Pipeline failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Done"), 0, 0);
		},
	});
}
