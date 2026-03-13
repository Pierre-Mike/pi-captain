// ── tools/run.ts — captain_run tool registration ──────────────────────────
// Interactive guard logic + tool registration.
// Context builders live in run-helpers.ts (Basic_knowledge.md ≤200 lines rule).

import type { TextContent } from "@mariozechner/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";

import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { PipelineState } from "../core/types.js";
import type { CaptainState } from "../state.js";
import {
	buildPipelineSelectOptions,
	parsePipelineSelectOption,
} from "../ui/select.js";
import { text } from "./helpers.js";
import { buildCompletionText, runPipeline } from "./run-helpers.js";

export type ExecCtx = ExtensionContext;

// ── Interactive guard types & helpers ──────────────────────────────────────
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

const cancelled = (): GuardResult => ({
	done: true,
	result: { content: [text("(cancelled)")], details: undefined },
});
const guardError = (msg: string): GuardResult => ({
	done: true,
	result: { content: [text(msg)], details: undefined },
});

async function selectAndAutoLoad(
	state: CaptainState,
	ctx: SelectCtx,
): Promise<string | GuardResult> {
	const options = buildPipelineSelectOptions(state);
	if (options.length === 0)
		return {
			done: true,
			result: {
				content: [
					text(
						"No pipelines available. Use captain_generate or captain_load first.",
					),
				],
				details: undefined,
			},
		};

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

async function resolveNameInteractively(
	state: CaptainState,
	hasInput: boolean,
	signal: AbortSignal | undefined,
	ctx: SelectCtx,
): Promise<GuardResult> {
	if (signal?.aborted) return cancelled();
	if (!ctx.hasUI)
		return guardError(
			'Error: pipeline "" not found. Generate one with captain_generate or load a preset with captain_load.',
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
	return cancelled();
}

// ── Tool registration ──────────────────────────────────────────────────────
export function registerRunTool(
	pi: ExtensionAPI,
	state: CaptainState,
	updateWidget: (ctx: ExecCtx, s: PipelineState) => void,
	clearWidget: (ctx: ExecCtx, s: PipelineState) => void,
) {
	pi.registerTool({
		name: "captain_run",
		label: "Captain Run",
		description:
			"Execute a defined captain pipeline. Runs steps according to composition rules (sequential/parallel/pool), manages git worktrees for isolation, chains $INPUT/$ORIGINAL through prompts, evaluates gates, handles failures. Returns final output. Runs in background (fire-and-forget) by default — pass background=false to wait for completion.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Pipeline name to run" })),
			input: Type.Optional(
				Type.String({
					description:
						"User's original request (becomes $ORIGINAL and initial $INPUT)",
				}),
			),
			background: Type.Optional(
				Type.Boolean({
					description:
						"Fire and forget — return immediately with a job ID. Use captain_kill to stop it, captain_status to check progress. Defaults to true.",
				}),
			),
		}),

		async execute(_id, params, signal, _onUpdate, ctx) {
			const resolvedInput: string | undefined = params.input;
			const resolvedName: string = params.name ?? "";
			const background: boolean = params.background ?? true;

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
				buildCompletionText,
				background,
			);
		},

		renderCall: (args, theme) => {
			const name = args.name as string | undefined;
			const input = args.input as string | undefined;
			if (!name)
				return new Text(
					theme.fg("toolTitle", theme.bold("captain_run")) +
						theme.fg("dim", " — select pipeline"),
					0,
					0,
				);
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
			const content =
				result.content[0] && "text" in result.content[0]
					? result.content[0].text
					: "";
			if (content.startsWith("Pipeline") && content.includes("failed:"))
				return new Text(theme.fg("error", "✗ Pipeline failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Done"), 0, 0);
		},
	});
}
