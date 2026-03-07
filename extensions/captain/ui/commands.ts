// ── Captain Slash Commands ─────────────────────────────────────────────────
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import type { ExecutorContext } from "../executor.js";
import { executeRunnable } from "../executor.js";
import type { CaptainState } from "../state.js";
import type { PipelineState, Runnable, Step } from "../types.js";
import {
	collectStepLabels,
	describeRunnable,
	findStepByLabel,
} from "../utils/index.js";
import { clearWidget, updateWidget } from "./widget.js";

type NotifyFn = (msg: string, level: "info" | "error") => void;

/** Parse --step flag out of raw args string; return { stepFilter, cleanedArgs } */
function parseStepFlag(raw: string): {
	stepFilter: string | undefined;
	cleanedArgs: string;
} {
	const stepMatch = raw.match(/--step\s+["']?([^"']+?)["']?(?:\s|$)/);
	const cleanedArgs = raw
		.replace(/--step\s+["']?[^"']+?["']?(?:\s|$)/, "")
		.trim();
	return { stepFilter: stepMatch?.[1].trim(), cleanedArgs };
}

/** Parse --key value flags from a string; return flags map and remaining prompt */
function parseInlineFlags(input: string): {
	flags: Record<string, string>;
	prompt: string;
} {
	const flags: Record<string, string> = {};
	const flagRe = /--(\w+)\s+([^-][^\s]*(?:\s+[^-][^\s]*)*?)(?=\s+--|$)/g;
	let m: RegExpExecArray | null;
	const toRemove: string[] = [];
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic while loop
	while ((m = flagRe.exec(input)) !== null) {
		flags[m[1]] = m[2].trim();
		toRemove.push(m[0]);
	}
	let rest = input;
	for (const rm of toRemove) rest = rest.replace(rm, "");
	return { flags, prompt: rest.trim() };
}

/** Build a Step spec from parsed /captain-step flags */
function buildAdHocStep(prompt: string, flags: Record<string, string>): Step {
	const label = flags.label ?? "ad-hoc step";
	const agentName = flags.agent;
	const modelId = flags.model;
	const toolsList = flags.tools?.split(",").map((t) => t.trim());
	return {
		kind: "step",
		label,
		prompt,
		gate: { type: "none" },
		onFail: { action: "skip" },
		transform: { kind: "full" },
		...(agentName
			? { agent: agentName }
			: {
					model: modelId,
					tools: toolsList ?? ["read", "bash", "edit", "write"],
				}),
	};
}

/** Ensure a named pipeline is loaded (auto-loads from presets). Returns false if the caller should abort. */
function ensurePipelineLoaded(
	name: string,
	cwd: string,
	state: CaptainState,
	notify: NotifyFn,
): boolean {
	if (state.pipelines[name]) return true;
	try {
		const resolved = state.resolvePreset(name, cwd);
		if (!resolved) {
			notify(
				`Pipeline "${name}" not found. Use /captain-load to see available presets.`,
				"error",
			);
			return false;
		}
		notify(`Auto-loaded preset "${name}"`, "info");
		return true;
	} catch (err) {
		notify(
			`Failed to load pipeline "${name}": ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return false;
	}
}

/** Parse and validate args for /captain-run; returns null if the handler should abort */
function parseCaptainRunArgs(
	args: string,
	state: CaptainState,
	cwd: string,
	notify: NotifyFn,
): {
	name: string;
	input: string;
	stepFilter: string | undefined;
	specToRun: Runnable;
} | null {
	const raw = args?.trim() ?? "";
	const { stepFilter, cleanedArgs } = parseStepFlag(raw);
	const parts = cleanedArgs.split(/\s+/);
	const name = parts[0];
	const input = parts.slice(1).join(" ");

	if (!name) {
		const loadedNames = Object.keys(state.pipelines);
		if (loadedNames.length === 0) {
			notify(
				"Usage: /captain-run <name> [--step <label>] <input>\nNo pipelines loaded. Use /captain-load first.",
				"error",
			);
		} else {
			notify(
				`Usage: /captain-run <name> [--step <label>] <input>\n\nLoaded pipelines:\n${loadedNames.map((n: string) => `  • ${n}`).join("\n")}`,
				"info",
			);
		}
		return null;
	}
	if (!input) {
		notify(
			`Usage: /captain-run ${name} [--step <label>] <input>\nProvide an input string after the pipeline name.`,
			"error",
		);
		return null;
	}
	if (!ensurePipelineLoaded(name, cwd, state, notify)) return null;

	let specToRun: Runnable | undefined = state.pipelines[name].spec;
	if (stepFilter) {
		specToRun = findStepByLabel(specToRun, stepFilter);
		if (!specToRun) {
			const labels = collectStepLabels(state.pipelines[name].spec);
			notify(
				`Step "${stepFilter}" not found in pipeline "${name}".\n\nAvailable steps:\n${labels.map((l) => `  • ${l}`).join("\n")}`,
				"error",
			);
			return null;
		}
	}

	return { name, input, stepFilter, specToRun };
}

/** Build an ExecutorContext from a slash-command context */
async function buildEctx(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: CaptainState,
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
	state.loadMdAgents(ctx.cwd);
	return {
		exec: (cmd, execArgs, opts) => pi.exec(cmd, execArgs, opts),
		agents: state.agents,
		model,
		modelRegistry: ctx.modelRegistry,
		apiKey,
		cwd: ctx.cwd,
		hasUI: ctx.hasUI,
		confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
		pipelineName: stateName,
		onStepStart: (label) => {
			pipelineState.currentStep = label;
			pipelineState.currentStepStream = undefined;
			updateWidget(ctx, pipelineState);
			ctx.ui.setStatus("captain", `🚀 ${stateName} → ${label}`);
		},
		onStepStream: (text) => {
			pipelineState.currentStepStream = text;
			updateWidget(ctx, pipelineState);
		},
		onStepEnd: (result) => {
			pipelineState.currentStep = undefined;
			pipelineState.currentStepStream = undefined;
			pipelineState.results.push(result);
			updateWidget(ctx, pipelineState);
		},
	};
}

/** Run a runnable spec directly from a slash command */
async function runRunnableFromCommand(
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

		const elapsed = (
			(pipelineState.endTime -
				(pipelineState.startTime ?? pipelineState.endTime)) /
			1000
		).toFixed(1);
		const passed = results.filter((r) => r.status === "passed").length;
		const failed = results.filter((r) => r.status === "failed").length;

		ctx.ui.setStatus("captain", undefined);
		clearWidget(ctx);
		ctx.ui.notify(
			`✓ "${pipelineState.name}" completed in ${elapsed}s — ${passed} passed, ${failed} failed\n\n${output.slice(0, 800)}${output.length > 800 ? "\n…(truncated)" : ""}`,
			failed > 0 ? "error" : "info",
		);
	} catch (err) {
		pipelineState.status = "failed";
		pipelineState.endTime = Date.now();
		ctx.ui.setStatus("captain", undefined);
		clearWidget(ctx);
		ctx.ui.notify(
			`✗ "${pipelineState.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
	}
}

export function registerCommands(pi: ExtensionAPI, state: CaptainState) {
	// /captain — list or show pipeline details
	pi.registerCommand("captain", {
		description:
			"Show pipeline details (/captain <name>) or list all (/captain)",
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
			const name = args?.trim();
			if (!name) {
				const lines = state.buildPipelineListLines(ctx.cwd);
				ctx.ui.notify(
					lines.length > 0
						? lines.join("\n")
						: "No pipelines defined or available.",
					"info",
				);
				return;
			}
			const p = state.pipelines[name];
			if (p) {
				ctx.ui.notify(
					`Pipeline "${name}":\n${describeRunnable(p.spec, 0)}`,
					"info",
				);
				return;
			}
			try {
				const resolved = state.resolvePreset(name, ctx.cwd);
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
		},
	});

	// /captain-agents — list all available agents
	pi.registerCommand("captain-agents", {
		description:
			"List all available agents (from .md files and runtime definitions)",
		handler: async (_args, ctx) => {
			const names = Object.keys(state.agents);
			if (names.length === 0) {
				ctx.ui.notify("No agents available.", "info");
				return;
			}
			const lines = names.map((n) => {
				const a = state.agents[n];
				const src = a.source === "md" ? "📄 md" : "⚡ runtime";
				return `• ${n} [${src}] — ${a.description} (tools: ${a.tools.join(", ")})`;
			});
			ctx.ui.notify(`Agents (${names.length}):\n${lines.join("\n")}`, "info");
		},
	});

	// /captain-run — run a pipeline or single step
	pi.registerCommand("captain-run", {
		description:
			"Run a pipeline directly: /captain-run <name> [--step <label>] <input>",
		getArgumentCompletions: (prefix) =>
			Object.keys(state.pipelines)
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({ value: n, label: n })),
		handler: async (args, ctx) => {
			const parsed = parseCaptainRunArgs(args, state, ctx.cwd, (msg, level) =>
				ctx.ui.notify(msg, level),
			);
			if (!parsed) return;
			const { name, input, stepFilter, specToRun } = parsed;
			if (stepFilter)
				ctx.ui.notify(`Running single step: "${stepFilter}"`, "info");
			const stateName = stepFilter ? `${name}/${stepFilter}` : name;
			const pipelineState: PipelineState = {
				name: stateName,
				spec: specToRun,
				status: "running",
				results: [],
				startTime: Date.now(),
			};
			state.runningState = pipelineState;
			updateWidget(ctx, pipelineState);
			await runRunnableFromCommand(
				pi,
				specToRun,
				input,
				pipelineState,
				state,
				ctx,
			);
		},
	});

	// /captain-load — load a preset pipeline
	pi.registerCommand("captain-load", {
		description:
			"Load a pipeline preset (/captain-load <name>). No args to list available presets.",
		getArgumentCompletions: (prefix) => {
			const presets = state.discoverPresets(process.cwd());
			return presets
				.filter((p) => p.name.startsWith(prefix))
				.map((p) => ({ value: p.name, label: `${p.name} (${p.source})` }));
		},
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				const presets = state.discoverPresets(ctx.cwd);
				if (presets.length === 0) {
					ctx.ui.notify(
						"No pipeline presets found. Place .json files in .pi/pipelines/",
						"info",
					);
					return;
				}
				ctx.ui.notify(
					`Available presets:\n${presets.map((p) => `• ${p.name} (${p.source})`).join("\n")}`,
					"info",
				);
				return;
			}
			try {
				let result: { name: string; agentCount: number; spec: Runnable };
				if (state.builtinPresetMap[name]) {
					result = state.loadBuiltinPreset(name);
				} else {
					const { existsSync } = await import("node:fs");
					const { join } = await import("node:path");
					const projectFile = join(ctx.cwd, ".pi", "pipelines", `${name}.json`);
					if (!existsSync(projectFile)) {
						ctx.ui.notify(
							`Preset "${name}" not found. Run /captain-load to see available presets.`,
							"error",
						);
						return;
					}
					result = state.loadPipelineFile(projectFile);
				}
				ctx.ui.notify(
					`✓ Loaded "${result.name}" (${result.agentCount} agents)\nRun with: /captain-run ${result.name} <input>`,
					"info",
				);
			} catch (err) {
				ctx.ui.notify(
					`Failed to load: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});

	// /captain-generate — delegate to LLM
	pi.registerCommand("captain-generate", {
		description:
			"Generate a pipeline on-the-fly with LLM (/captain-generate <goal>)",
		handler: async (args, _ctx) => {
			const goal = args?.trim();
			if (!goal) {
				_ctx.ui.notify(
					"Usage: /captain-generate <what you want the pipeline to do>",
					"error",
				);
				return;
			}
			pi.sendUserMessage(
				`Generate a captain pipeline for this goal: ${goal}\nUse captain_generate tool with goal="${goal}".`,
			);
		},
	});

	// /captain-step — run a single ad-hoc step
	pi.registerCommand("captain-step", {
		description:
			"Run a single ad-hoc step inline: /captain-step <prompt> [--agent <name>] [--model <id>] [--tools <t1,t2>] [--label <label>]",
		getArgumentCompletions: (prefix) => {
			const flags = ["--agent ", "--model ", "--tools ", "--label "];
			return flags
				.filter((f) => f.startsWith(prefix))
				.map((f) => ({ value: f, label: f.trim() }));
		},
		handler: async (args, ctx) => {
			const raw = args?.trim() ?? "";
			if (!raw) {
				ctx.ui.notify(
					[
						"Usage: /captain-step <prompt> [options]",
						"",
						"Options:",
						"  --agent <name>     Use a named agent (overrides --model/--tools)",
						"  --model <id>       Model to use (default: current model)",
						"  --tools <t1,t2>    Comma-separated tools (default: read,bash,edit,write)",
						"  --label <text>     Step label shown in UI (default: 'ad-hoc step')",
					].join("\n"),
					"info",
				);
				return;
			}
			const { flags, prompt } = parseInlineFlags(raw);
			if (!prompt) {
				ctx.ui.notify("Provide a prompt after the flags.", "error");
				return;
			}
			const stepSpec = buildAdHocStep(prompt, flags);
			const pipelineState: PipelineState = {
				name: `step:${stepSpec.label}`,
				spec: stepSpec,
				status: "running",
				results: [],
				startTime: Date.now(),
			};
			state.runningState = pipelineState;
			updateWidget(ctx, pipelineState);
			await runRunnableFromCommand(
				pi,
				stepSpec,
				prompt,
				pipelineState,
				state,
				ctx,
			);
		},
	});

	// /captain-help — show all commands
	pi.registerCommand("captain-help", {
		description: "Show all captain commands and usage",
		handler: async (_args, ctx) => {
			const pipelineCount = Object.keys(state.pipelines).length;
			const agentCount = Object.keys(state.agents).length;
			ctx.ui.notify(
				[
					`Captain — Multi-agent Pipeline Orchestrator  (${pipelineCount} pipeline(s), ${agentCount} agent(s))`,
					"",
					"── Pipeline Commands ─────────────────────────────────────────",
					"  /captain                     List all loaded pipelines",
					"  /captain <name>              Show structure of a pipeline",
					"  /captain-load                List available presets",
					"  /captain-load <name>         Load a preset pipeline",
					"  /captain-run <name> <input>  Run a full pipeline directly",
					"  /captain-run <name> --step <label> <input>",
					"                               Run a single step from a pipeline",
					"",
					"── Ad-hoc Step ───────────────────────────────────────────────",
					"  /captain-step <prompt>                    Run with default tools",
					"  /captain-step <prompt> --agent <name>     Run with a named agent",
					"  /captain-step <prompt> --model <id>       Override model",
					"  /captain-step <prompt> --tools <t1,t2>    Override tools",
					"  /captain-step <prompt> --label <text>     Set display label",
					"",
					"── Generation & Agents ───────────────────────────────────────",
					"  /captain-generate <goal>     Generate a pipeline with LLM",
					"  /captain-agents              List all available agents",
					"",
					"── Tips ──────────────────────────────────────────────────────",
					"  • /captain-run auto-loads presets — no need to /captain-load first",
					"  • Use --step to debug or replay a single step from any pipeline",
					"  • Tab-complete pipeline names after /captain-run and /captain-load",
				].join("\n"),
				"info",
			);
		},
	});
}
