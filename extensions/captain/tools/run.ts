import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { CaptainDetails, PipelineState, StepResult } from "../types.js";
import { statusIcon } from "../utils/index.js";

export function registerRunTool(
	pi: ExtensionAPI,
	state: CaptainState,
	updateWidget: (
		ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
		s: PipelineState,
	) => void,
	clearWidget: (
		ctx: Parameters<Parameters<ExtensionAPI["registerTool"]>[0]["execute"]>[4],
	) => void,
) {
	pi.registerTool({
		name: "captain_run",
		label: "Captain Run",
		description:
			"Execute a defined captain pipeline. Runs steps according to composition rules (sequential/parallel/pool), manages git worktrees for isolation, chains $INPUT/$ORIGINAL through prompts, evaluates gates, handles failures. Returns final output.",
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name to run" }),
			input: Type.String({
				description:
					"User's original request (becomes $ORIGINAL and initial $INPUT)",
			}),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const pipeline = state.pipelines[params.name];
			if (!pipeline) {
				return {
					content: [
						{
							type: "text",
							text: `Error: pipeline "${params.name}" not found. Define it first with captain_define.`,
						},
					],
					isError: true,
				};
			}

			const pipelineState: PipelineState = {
				name: params.name,
				spec: pipeline.spec,
				status: "running",
				results: [],
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

			const ectx: ExecutorContext = {
				exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
				agents: state.agents,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				apiKey,
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
				confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
				signal: signal ?? undefined,
				pipelineName: params.name,
				onStepStart: (label) => {
					pipelineState.currentStep = label;
					pipelineState.currentStepStream = undefined;
					updateWidget(ctx, pipelineState);
					onUpdate?.({
						content: [{ type: "text", text: `⏳ Running step: ${label}...` }],
					});
					ctx.ui.setStatus("captain", `🚀 ${params.name} → ${label}`);
				},
				onStepStream: (text) => {
					pipelineState.currentStepStream = text;
					updateWidget(ctx, pipelineState);
				},
				onStepEnd: (result: StepResult) => {
					pipelineState.currentStep = undefined;
					pipelineState.currentStepStream = undefined;
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

			try {
				const { output, results } = await executeRunnable(
					pipeline.spec,
					params.input,
					params.input,
					ectx,
				);

				pipelineState.status = "completed";
				pipelineState.finalOutput = output;
				pipelineState.endTime = Date.now();
				pipelineState.results = results;

				const { content: truncated } = truncateHead(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				const elapsed = (
					(pipelineState.endTime -
						(pipelineState.startTime ?? pipelineState.endTime)) /
					1000
				).toFixed(1);
				const summary = [
					`Pipeline "${params.name}" completed in ${elapsed}s`,
					`Steps: ${results.length} (${results.filter((r) => r.status === "passed").length} passed, ${results.filter((r) => r.status === "failed").length} failed, ${results.filter((r) => r.status === "skipped").length} skipped)`,
					"",
					"── Output ──",
					truncated,
				].join("\n");

				ctx.ui.setStatus("captain", undefined);
				clearWidget(ctx);

				return {
					content: [{ type: "text", text: summary }],
					details: state.snapshot(pipelineState),
				};
			} catch (err) {
				pipelineState.status = "failed";
				pipelineState.endTime = Date.now();
				ctx.ui.setStatus("captain", undefined);
				clearWidget(ctx);

				return {
					content: [
						{
							type: "text",
							text: `Pipeline "${params.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: state.snapshot(pipelineState),
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_run ")) +
					theme.fg("accent", args.name) +
					theme.fg("dim", " — ") +
					theme.fg(
						"muted",
						`"${(args.input as string).slice(0, 55)}${(args.input as string).length > 55 ? "…" : ""}"`,
					),
				0,
				0,
			),
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
