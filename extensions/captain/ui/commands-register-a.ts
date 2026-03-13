// ── ui/commands-register-a.ts — /captain ─────────────────────────────────────
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PipelineState } from "../core/types.js";
import type { CaptainState } from "../state.js";
import {
	runInteractivePipelineLauncher,
	runRunnableFromCommand,
	showPipelineDetails,
} from "./commands-exec.js";
import {
	ensurePipelineLoaded,
	parsePipelineAndInput,
} from "./commands-parse.js";
import { updateWidget } from "./widget.js";

export function registerCommandsA(pi: ExtensionAPI, state: CaptainState): void {
	// /captain — interactive: select pipeline then enter input, or show details
	pi.registerCommand("captain", {
		description:
			"Interactive pipeline launcher (/captain) or show details (/captain <name>)",
		getArgumentCompletions: (prefix) => {
			const presets = state.discoverPresets(process.cwd());
			const allNames = new Set([
				...Object.keys(state.pipelines),
				...presets.map((p) => p.name),
			]);
			return [...allNames]
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({
					value: n,
					label: state.pipelines[n]
						? n
						: `${n} (${presets.find((p) => p.name === n)?.source ?? "preset"})`,
				}));
		},
		handler: async (args, ctx) => {
			const raw = args?.trim() ?? "";
			if (!raw) {
				// No args → interactive launcher (pick pipeline + enter input)
				await runInteractivePipelineLauncher(pi, state, ctx);
				return;
			}

			const { pipeline, input } = parsePipelineAndInput(raw);

			if (!input) {
				// Only a name/path provided → show details
				await showPipelineDetails(pipeline, state, ctx);
				return;
			}

			// Both pipeline and input provided → load (if needed) and run immediately
			const notify = (msg: string, level: "info" | "error") =>
				ctx.ui.notify(msg, level);

			const resolvedName = await ensurePipelineLoaded(
				pipeline,
				ctx.cwd,
				state,
				notify,
			);
			if (!resolvedName) return;

			const spec = state.pipelines[resolvedName].spec;
			const pipelineState: PipelineState = {
				name: resolvedName,
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
			await runRunnableFromCommand(pi, spec, input, pipelineState, state, ctx);
		},
	});
}
