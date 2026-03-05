// ── Captain: Agent Orchestration Pipeline Extension ────────────────────────
// Composable, type-safe multi-agent pipelines with sequential, parallel, and
// pool execution patterns, git worktree isolation, gates, and merge strategies.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	truncateHead,
} from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { type ExecutorContext, executeRunnable } from "./executor.js";
import { generatePipeline } from "./generator.js";
import * as builtinPipelines from "./pipelines/index.js";
import type {
	Agent,
	AgentName,
	CaptainDetails,
	PipelineState,
	Runnable,
} from "./types.js";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
	// ── State ──────────────────────────────────────────────────────────────
	let pipelines: Record<string, { spec: Runnable }> = {};
	let agents: Record<string, Agent> = {};
	let runningState: PipelineState | null = null;

	// ── Agent Discovery from .md Files ──────────────────────────────────────
	// Auto-load agents from ~/.pi/agent/agents/*.md so /captain-agents works
	// immediately without requiring a pipeline to be loaded first.

	const AGENTS_DIR = join(homedir(), ".pi", "agent", "agents");

	/** Recursively find all .md files in a directory */
	function findMdFiles(dir: string): string[] {
		if (!existsSync(dir)) return [];
		const files: string[] = [];
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			try {
				if (statSync(full).isDirectory()) files.push(...findMdFiles(full));
				else if (entry.endsWith(".md")) files.push(full);
			} catch {
				/* skip unreadable */
			}
		}
		return files;
	}

	/** Parse a .md agent file → Agent object (returns null if invalid) */
	function parseMdAgent(filePath: string): Agent | null {
		const content = readFileSync(filePath, "utf-8");
		const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!fmMatch) return null;

		const fm = fmMatch[1];
		const body = content.slice(fmMatch[0].length).trim();

		// Extract frontmatter fields
		const getName = (s: string) =>
			s
				.split("\n")
				.find((l) => l.startsWith("name:"))
				?.slice(5)
				.trim();
		const getDesc = (s: string) =>
			s
				.split("\n")
				.find((l) => l.startsWith("description:"))
				?.slice(12)
				.trim();
		const getTools = (s: string) =>
			s
				.split("\n")
				.find((l) => l.startsWith("tools:"))
				?.slice(6)
				.trim();

		const name = getName(fm);
		if (!name) return null;

		return {
			name: name as AgentName, // loaded from agents/*.md
			description: getDesc(fm) ?? "",
			tools:
				getTools(fm)
					?.split(",")
					.map((t) => t.trim()) ?? [],
			systemPrompt: body || undefined,
			source: "md",
		};
	}

	/** Discover and register all .md agent files (won't overwrite runtime-defined agents) */
	function loadMdAgents() {
		for (const filePath of findMdFiles(AGENTS_DIR)) {
			const agent = parseMdAgent(filePath);
			if (!agent) continue;
			// Only register if not already defined at runtime (runtime takes precedence)
			if (!agents[agent.name] || agents[agent.name].source !== "runtime") {
				agents[agent.name] = agent;
			}
		}
	}

	// Load .md agents immediately on extension init
	loadMdAgents();

	// ── Session Reconstruction ─────────────────────────────────────────────
	// Rebuild state from tool result details on branch navigation.
	const CAPTAIN_TOOLS = new Set([
		"captain_define",
		"captain_load",
		"captain_run",
		"captain_list",
		"captain_status",
		"captain_agent",
		"captain_generate",
	]);

	/** Apply a CaptainDetails snapshot to current state */
	function applyCaptainDetails(d: CaptainDetails): void {
		pipelines = d.pipelines ?? pipelines;
		agents = d.agents ?? agents;
		if (d.lastRun) runningState = d.lastRun.state;
	}

	const reconstruct = (ctx: ExtensionContext) => {
		pipelines = {};
		agents = {};
		runningState = null;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "toolResult")
				continue;
			if (!CAPTAIN_TOOLS.has(entry.message.toolName)) continue;
			const d = entry.message.details as CaptainDetails | undefined;
			if (d) applyCaptainDetails(d);
		}

		loadMdAgents();
	};

	pi.on("session_start", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_fork", async (_e, ctx) => reconstruct(ctx));
	pi.on("session_tree", async (_e, ctx) => reconstruct(ctx));

	// ── Bundled Skill ──────────────────────────────────────────────────────
	pi.on("resources_discover", () => ({
		skillPaths: [join(baseDir, "skill", "SKILL.md")],
		promptPaths: [join(baseDir, "prompts", "orchestrate.md")],
	}));

	// ── Helper: create state snapshot for details ──────────────────────────
	function snapshot(lastRun?: PipelineState): CaptainDetails {
		return {
			pipelines: { ...pipelines },
			agents: { ...agents },
			lastRun: lastRun
				? { name: lastRun.name, state: { ...lastRun } }
				: undefined,
		};
	}

	// ── Tool: captain_agent ──────────────────────────────────────────────────
	pi.registerTool({
		name: "captain_agent",
		label: "Captain Agent",
		description:
			"Define a reusable agent config with name, description, tools, model, and temperature. Agents are referenced by name in pipeline steps.",
		parameters: Type.Object({
			name: Type.String({ description: "Unique agent name" }),
			description: Type.String({ description: "What this agent does" }),
			tools: Type.String({
				description: "Comma-separated tool names (e.g. 'read,bash,edit')",
			}),
			model: Type.Optional(
				Type.String({
					description: "Model identifier (e.g. 'sonnet', 'flash')",
				}),
			),
			temperature: Type.Optional(
				Type.Number({ description: "Sampling temperature (0-1)" }),
			),
		}),

		async execute(_id, params) {
			const agent: Agent = {
				name: params.name as AgentName, // runtime-defined, bypasses known agent check
				description: params.description,
				tools: params.tools.split(",").map((t: string) => t.trim()),
				model: params.model,
				temperature: params.temperature,
				source: "runtime",
			};
			agents[params.name] = agent;

			return {
				content: [
					{
						type: "text",
						text: `Agent "${params.name}" defined: ${params.description} (tools: ${agent.tools.join(", ")})`,
					},
				],
				details: snapshot(),
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_agent ")) +
					theme.fg("accent", args.name),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			const d = result.details as CaptainDetails | undefined;
			if (!d) return new Text(theme.fg("success", "✓ Agent defined"), 0, 0);
			const total = Object.keys(d.agents).length;
			const mdCount = Object.values(d.agents).filter(
				(a) => a.source === "md",
			).length;
			const rtCount = total - mdCount;
			return new Text(
				theme.fg(
					"success",
					`✓ ${total} agent(s) (${mdCount} md, ${rtCount} runtime)`,
				),
				0,
				0,
			);
		},
	});

	// ── Pipeline & Agent Discovery ──────────────────────────────────────
	// Built-in presets are TS modules in agents/ and pipelines/ folders.
	// Project-local presets can still be .json in .pi/pipelines/.

	/** Built-in pipeline registry from pipelines/*.ts modules.
	 *  Agents are loaded from ~/.pi/agent/agents/*.md — pipelines only export the spec. */
	const builtinPresetMap: Record<string, { pipeline: Runnable }> = {};
	for (const [key, mod] of Object.entries(builtinPipelines)) {
		// Convert camelCase export name to kebab-case preset name
		const name = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
		builtinPresetMap[name] = { pipeline: mod.pipeline };
	}

	/** List available pipeline presets (builtin TS + project-local JSON) */
	function discoverPresets(
		cwd: string,
	): { name: string; source: "builtin" | "project" }[] {
		const presets: { name: string; source: "builtin" | "project" }[] = [];

		// Built-in presets from pipelines/*.ts
		for (const name of Object.keys(builtinPresetMap)) {
			presets.push({ name, source: "builtin" });
		}

		// Project-local pipelines (.pi/pipelines/*.json in project root)
		const projectDir = join(cwd, ".pi", "pipelines");
		if (existsSync(projectDir)) {
			for (const f of readdirSync(projectDir).filter((f) =>
				f.endsWith(".json"),
			)) {
				presets.push({ name: basename(f, ".json"), source: "project" });
			}
		}

		return presets;
	}

	/** Load a built-in TS preset by name → register its pipeline.
	 *  Agents are already loaded from ~/.pi/agent/agents/*.md at init. */
	function loadBuiltinPreset(name: string): {
		name: string;
		agentCount: number;
		spec: Runnable;
	} {
		const preset = builtinPresetMap[name];
		if (!preset) throw new Error(`Builtin preset "${name}" not found`);

		pipelines[name] = { spec: preset.pipeline };

		// Count agents referenced by this pipeline (all come from .md files)
		const referencedAgents = collectAgentRefs(preset.pipeline);
		const uniqueAgents = [...new Set(referencedAgents)];
		return { name, agentCount: uniqueAgents.length, spec: preset.pipeline };
	}

	/** Load a project-local JSON pipeline file → register its agents and spec */
	function loadPipelineFile(filePath: string): {
		name: string;
		agentCount: number;
		spec: Runnable;
	} {
		const raw = readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw) as {
			agents?: Record<string, Agent>;
			pipeline: Runnable;
		};

		if (!data.pipeline?.kind) {
			throw new Error(
				"Invalid pipeline file: missing 'pipeline' with 'kind' field",
			);
		}

		const agentEntries = Object.entries(data.agents ?? {});
		for (const [key, agent] of agentEntries) {
			agents[key] = { ...agent, name: key as AgentName }; // from JSON pipeline file
		}

		const name = basename(filePath, ".json");
		pipelines[name] = { spec: data.pipeline };
		return { name, agentCount: agentEntries.length, spec: data.pipeline };
	}

	/** Resolve a preset name to a loaded pipeline, checking builtin → project → file path */
	function resolvePreset(
		name: string,
		cwd: string,
	):
		| { name: string; agentCount: number; spec: Runnable; source?: string }
		| undefined {
		// 1. Check builtin TS presets
		if (builtinPresetMap[name]) {
			return loadBuiltinPreset(name);
		}

		// 2. Check project-local .pi/pipelines/*.json
		const projectFile = join(cwd, ".pi", "pipelines", `${name}.json`);
		if (existsSync(projectFile)) {
			return loadPipelineFile(projectFile);
		}

		// 3. Try as direct file path (absolute or relative to cwd)
		const candidate = resolve(cwd, name);
		const filePath = existsSync(candidate)
			? candidate
			: existsSync(name)
				? resolve(name)
				: undefined;

		if (filePath) {
			const result = loadPipelineFile(filePath);
			return { ...result, source: filePath };
		}

		return undefined;
	}

	/** List all available presets as a tool result */
	function listPresets(cwd: string) {
		const presets = discoverPresets(cwd);
		if (presets.length === 0) {
			return {
				content: [
					{
						type: "text" as const,
						text: "No presets found. Add .ts modules to pipelines/ or .json files to .pi/pipelines/",
					},
				],
				details: snapshot(),
			};
		}
		const lines = presets.map((p) => `  • ${p.name} (${p.source})`);
		return {
			content: [
				{
					type: "text" as const,
					text: `Available pipeline presets:\n${lines.join("\n")}`,
				},
			],
			details: snapshot(),
		};
	}

	// ── Tool: captain_load ──────────────────────────────────────────────────
	pi.registerTool({
		name: "captain_load",
		label: "Captain Load",
		description: [
			"Load a precreated pipeline from a JSON file. Accepts either:",
			"  - A preset name (e.g. 'research-and-summarize') from builtin samples or .pi/pipelines/",
			"  - An absolute or relative file path to a pipeline JSON file",
			"",
			"Pipeline JSON format: { agents: { ... }, pipeline: { kind, ... } }",
			"Use action 'list' to see all available presets.",
		].join("\n"),
		parameters: Type.Object({
			action: Type.Union([Type.Literal("load"), Type.Literal("list")]),
			name: Type.Optional(
				Type.String({
					description: "Preset name or file path (required for 'load')",
				}),
			),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd;

			if (params.action === "list") {
				return listPresets(cwd);
			}

			// action === "load"
			if (!params.name) {
				return {
					content: [
						{
							type: "text",
							text: "Error: 'name' is required for load action. Use action 'list' to see available presets.",
						},
					],
					isError: true,
				};
			}

			// Resolve: check builtin TS presets first, then project JSON, then file path
			const name = params.name;
			try {
				const resolved = resolvePreset(name, cwd);
				if (!resolved) {
					return {
						content: [
							{
								type: "text",
								text: `Error: preset or file "${name}" not found.\nUse action 'list' to see available presets, or provide a valid file path.`,
							},
						],
						isError: true,
					};
				}
				const summary = describeRunnable(resolved.spec, 0);
				return {
					content: [
						{
							type: "text",
							text: `Loaded pipeline "${resolved.name}" (${resolved.agentCount} agents)${resolved.source ? ` from ${resolved.source}` : ""}\n\n${summary}`,
						},
					],
					details: snapshot(),
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error loading pipeline: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_load ")) +
					theme.fg(
						"accent",
						args.action === "list" ? "list" : (args.name ?? ""),
					),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			if (result.isError)
				return new Text(theme.fg("error", "✗ Load failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline loaded"), 0, 0);
		},
	});

	// ── Tool: captain_define ──────────────────────────────────────────────
	pi.registerTool({
		name: "captain_define",
		label: "Captain Define",
		description: [
			"Define a pipeline from a JSON spec (the Runnable tree).",
			"Runnable types: step, sequential, pool, parallel — infinitely nestable.",
			"",
			"Step shape: { kind: 'step', label, agent, description, prompt, gate, onFail, transform }",
			"  - prompt supports $INPUT (previous output) and $ORIGINAL (user request)",
			"  - gate: { type: 'command'|'user'|'file'|'assert'|'llm'|'none', value }",
			"  - llm gate: { type: 'llm', prompt: 'evaluation criteria', model?: 'flash', threshold?: 0.7 }",
			"  - onFail: { action: 'retry'|'skip'|'fallback', max?, step? }",
			"  - transform: { kind: 'full'|'extract'|'summarize', key? }",
			"",
			"Sequential: { kind: 'sequential', steps: Runnable[], gate?, onFail? }",
			"Pool: { kind: 'pool', step: Runnable, count: N, merge: { strategy }, gate?, onFail? }",
			"Parallel: { kind: 'parallel', steps: Runnable[], merge: { strategy }, gate?, onFail? }",
			"MergeStrategy: 'concat'|'awaitAll'|'firstPass'|'vote'|'rank'",
			"",
			"Define agents first with captain_agent, then reference them by name.",
		].join("\n"),
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name" }),
			spec: Type.String({ description: "JSON string of the Runnable tree" }),
		}),

		async execute(_id, params) {
			try {
				const spec = JSON.parse(params.spec) as Runnable;

				// Basic validation
				if (!spec.kind) {
					return {
						content: [
							{
								type: "text",
								text: "Error: spec must have a 'kind' field (step, sequential, pool, parallel)",
							},
						],
						isError: true,
					};
				}

				// Validate all agent references in the spec exist
				const unknownAgents = collectAgentRefs(spec).filter(
					(name) => !agents[name],
				);
				if (unknownAgents.length > 0) {
					const available = Object.keys(agents).join(", ");
					return {
						content: [
							{
								type: "text",
								text: `Error: unknown agent(s): ${unknownAgents.join(", ")}.\nAvailable agents: ${available}`,
							},
						],
						isError: true,
					};
				}

				pipelines[params.name] = { spec };

				const summary = describeRunnable(spec, 0);
				return {
					content: [
						{
							type: "text",
							text: `Captain pipeline "${params.name}" defined:\n${summary}`,
						},
					],
					details: snapshot(),
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Error parsing pipeline spec: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_define ")) +
					theme.fg("accent", args.name),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			if (result.isError)
				return new Text(theme.fg("error", "✗ Invalid spec"), 0, 0);
			const d = result.details as CaptainDetails | undefined;
			const count = d ? Object.keys(d.pipelines).length : 0;
			return new Text(
				theme.fg("success", `✓ ${count} pipeline(s) defined`),
				0,
				0,
			);
		},
	});

	// ── Tool: captain_run ───────────────────────────────────────────────────
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
			const pipeline = pipelines[params.name];
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

			// Pre-flight: validate all agent references before running
			const unknownAgents = collectAgentRefs(pipeline.spec).filter(
				(name) => !agents[name],
			);
			if (unknownAgents.length > 0) {
				const available = Object.keys(agents).join(", ");
				return {
					content: [
						{
							type: "text",
							text: `Error: pipeline references unknown agent(s): ${unknownAgents.join(", ")}.\nAvailable agents: ${available}`,
						},
					],
					isError: true,
				};
			}

			// Initialize running state
			const state: PipelineState = {
				name: params.name,
				spec: pipeline.spec,
				status: "running",
				results: [],
				startTime: Date.now(),
			};
			runningState = state;

			// Show live widget during execution
			updateWidget(ctx, state);

			// Get API key for LLM calls within steps
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

			// Build executor context
			const ectx: ExecutorContext = {
				exec: (cmd, args, opts) => pi.exec(cmd, args, opts),
				agents,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				apiKey,
				cwd: ctx.cwd,
				hasUI: ctx.hasUI,
				confirm: ctx.hasUI ? (t, b) => ctx.ui.confirm(t, b) : undefined,
				signal: signal ?? undefined,
				pipelineName: params.name,
				extensionTools: undefined, // Phase 1: built-in tools only; Phase 2: wrap extension tools
				onStepStart: (label) => {
					// Stream progress update
					onUpdate?.({
						content: [{ type: "text", text: `⏳ Running step: ${label}...` }],
					});
					ctx.ui.setStatus("captain", `🚀 ${params.name} → ${label}`);
				},
				onStepEnd: (result) => {
					state.results.push(result);
					updateWidget(ctx, state);
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

				state.status = "completed";
				state.finalOutput = output;
				state.endTime = Date.now();
				state.results = results;

				// Truncate output to avoid context overflow
				const { content: truncated } = truncateHead(output, {
					maxLines: DEFAULT_MAX_LINES,
					maxBytes: DEFAULT_MAX_BYTES,
				});

				// Build result summary
				const elapsed = (
					(state.endTime - (state.startTime ?? state.endTime)) /
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
					details: snapshot(state),
				};
			} catch (err) {
				state.status = "failed";
				state.endTime = Date.now();

				ctx.ui.setStatus("captain", undefined);
				clearWidget(ctx);

				return {
					content: [
						{
							type: "text",
							text: `Pipeline "${params.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: snapshot(state),
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_run ")) +
					theme.fg("accent", args.name) +
					theme.fg(
						"dim",
						` "${(args.input as string).slice(0, 60)}${(args.input as string).length > 60 ? "…" : ""}"`,
					),
				0,
				0,
			),
		renderResult: (result, { isPartial }, theme) => {
			if (isPartial)
				return new Text(theme.fg("warning", "⏳ Running pipeline..."), 0, 0);
			if (result.isError)
				return new Text(theme.fg("error", "✗ Pipeline failed"), 0, 0);
			const d = result.details as CaptainDetails | undefined;
			if (!d?.lastRun) return new Text(theme.fg("success", "✓ Done"), 0, 0);
			const s = d.lastRun.state;
			const elapsed =
				s.endTime && s.startTime
					? ((s.endTime - s.startTime) / 1000).toFixed(1)
					: "?";
			return new Text(
				theme.fg("success", `✓ ${s.results.length} steps in ${elapsed}s`) +
					theme.fg(
						"dim",
						` (${s.results.filter((r) => r.status === "passed").length}✓ ${s.results.filter((r) => r.status === "failed").length}✗)`,
					),
				0,
				0,
			);
		},
	});

	// ── Tool: captain_status ──────────────────────────────────────────────
	pi.registerTool({
		name: "captain_status",
		label: "Captain Status",
		description:
			"Check status of a running or completed captain pipeline. Shows step-by-step results, gates, and errors.",
		parameters: Type.Object({
			name: Type.String({ description: "Pipeline name" }),
		}),

		async execute(_id, params) {
			if (!runningState || runningState.name !== params.name) {
				const pipeline = pipelines[params.name];
				if (!pipeline) {
					return {
						content: [
							{ type: "text", text: `Pipeline "${params.name}" not found.` },
						],
						isError: true,
					};
				}
				return {
					content: [
						{
							type: "text",
							text: `Pipeline "${params.name}" defined but has not been run yet.`,
						},
					],
					details: snapshot(),
				};
			}

			const s = runningState;
			const lines = [
				`Pipeline: ${s.name} — Status: ${s.status}`,
				s.startTime ? `Started: ${new Date(s.startTime).toISOString()}` : "",
				s.endTime ? `Ended: ${new Date(s.endTime).toISOString()}` : "",
				"",
				"── Steps ──",
				...s.results.map(
					(r) =>
						`${statusIcon(r.status)} ${r.label}: ${r.status} (${(r.elapsed / 1000).toFixed(1)}s)${r.gateResult ? ` [gate: ${r.gateResult.passed ? "pass" : "fail"}]` : ""}${r.error ? ` — ${r.error}` : ""}`,
				),
			].filter(Boolean);

			if (s.finalOutput) {
				lines.push("", "── Final Output ──", s.finalOutput.slice(0, 2000));
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: snapshot(s),
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_status ")) +
					theme.fg("muted", args.name),
				0,
				0,
			),
	});

	/** Build display lines for all pipelines (loaded + unloaded presets) */
	function buildPipelineListLines(cwd: string): string[] {
		const names = Object.keys(pipelines);
		const lines = names.map((name) => {
			const p = pipelines[name];
			return `• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`;
		});

		appendUnloadedBuiltins(lines);
		appendUnloadedProjectPresets(lines, cwd);
		return lines;
	}

	function appendUnloadedBuiltins(lines: string[]): void {
		const unloaded = Object.keys(builtinPresetMap).filter((n) => !pipelines[n]);
		if (unloaded.length === 0) return;
		lines.push("");
		lines.push("Available presets (use captain_load to activate):");
		for (const name of unloaded) {
			lines.push(`  • ${name} (builtin)`);
		}
	}

	function appendUnloadedProjectPresets(lines: string[], cwd: string): void {
		const projectDir = join(cwd, ".pi", "pipelines");
		if (!existsSync(projectDir)) return;
		const unloadedJson = readdirSync(projectDir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => basename(f, ".json"))
			.filter((n) => !pipelines[n]);
		if (unloadedJson.length === 0) return;
		lines.push("  Project presets:");
		for (const name of unloadedJson) {
			lines.push(`  • ${name} (project)`);
		}
	}

	// ── Tool: captain_list ──────────────────────────────────────────────────
	pi.registerTool({
		name: "captain_list",
		label: "Captain List",
		description: "List all defined pipelines with their structure summary.",
		parameters: Type.Object({}),

		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const cwd = ctx?.cwd ?? process.cwd();
			const lines = buildPipelineListLines(cwd);

			if (lines.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No pipelines defined or available. Use captain_define to create one.",
						},
					],
					details: snapshot(),
				};
			}

			const loaded = Object.keys(pipelines).length;
			const header = loaded > 0 ? `${loaded} pipeline(s) loaded:\n\n` : "";
			return {
				content: [{ type: "text", text: `${header}${lines.join("\n")}` }],
				details: snapshot(),
			};
		},

		renderCall: (_args, theme) =>
			new Text(theme.fg("toolTitle", theme.bold("captain_list")), 0, 0),
		renderResult: (result, _opts, theme) => {
			const d = result.details as CaptainDetails | undefined;
			const count = d ? Object.keys(d.pipelines).length : 0;
			return new Text(theme.fg("success", `${count} pipeline(s)`), 0, 0);
		},
	});

	// ── Tool: captain_generate ────────────────────────────────────────────
	// LLM-powered pipeline generator — inspects available agents, gates,
	// and steps, then generates a complete pipeline spec on-the-fly.
	pi.registerTool({
		name: "captain_generate",
		label: "Captain Generate",
		description: [
			"Generate a pipeline on-the-fly using LLM. Inspects all available agents,",
			"gate types, and step patterns, then produces a complete pipeline spec.",
			"The generated pipeline is immediately registered and ready to run.",
			"",
			"Examples:",
			'  captain_generate({ goal: "review this PR for security and quality" })',
			'  captain_generate({ goal: "build a REST API with tests", dryRun: true })',
			'  captain_generate({ goal: "research and document best practices for auth" })',
		].join("\n"),
		parameters: Type.Object({
			goal: Type.String({
				description: "What you want the pipeline to accomplish",
			}),
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"If true, show the generated spec without registering it",
				}),
			),
		}),

		async execute(_id, params, signal, onUpdate, ctx) {
			const agentCount = Object.keys(agents).length;
			if (agentCount === 0) {
				return {
					content: [
						{
							type: "text",
							text: "No agents available. Define agents with captain_agent or add .md files to ~/.pi/agent/agents/",
						},
					],
					isError: true,
				};
			}

			onUpdate?.({
				content: [
					{
						type: "text",
						text: `🧠 Generating pipeline for: "${params.goal}" (${agentCount} agents available)...`,
					},
				],
			});

			try {
				// Resolve model and API key for the generation LLM call
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

				const generated = await generatePipeline(
					params.goal,
					agents,
					ctx.model,
					apiKey,
					signal ?? undefined,
				);

				// Pretty-print the generated spec for display
				const specJson = JSON.stringify(generated.pipeline, null, 2);
				const summary = describeRunnable(generated.pipeline, 0);

				if (params.dryRun) {
					return {
						content: [
							{
								type: "text",
								text: [
									`🔍 Dry Run — Generated pipeline "${generated.name}"`,
									`Description: ${generated.description}`,
									"",
									"── Structure ──",
									summary,
									"",
									"── Full Spec (JSON) ──",
									specJson,
									"",
									`To register: call captain_generate with the same goal and dryRun=false`,
								].join("\n"),
							},
						],
						details: snapshot(),
					};
				}

				// Register the pipeline immediately
				pipelines[generated.name] = { spec: generated.pipeline };

				return {
					content: [
						{
							type: "text",
							text: [
								`✓ Generated and registered pipeline "${generated.name}"`,
								`Description: ${generated.description}`,
								"",
								"── Structure ──",
								summary,
								"",
								`Run it with: captain_run({ name: "${generated.name}", input: "<your input>" })`,
							].join("\n"),
						},
					],
					details: snapshot(),
				};
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `Pipeline generation failed: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					isError: true,
				};
			}
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_generate ")) +
					theme.fg(
						"accent",
						`"${(args.goal as string).slice(0, 50)}${(args.goal as string).length > 50 ? "…" : ""}"`,
					),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			if (result.isError)
				return new Text(theme.fg("error", "✗ Generation failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline generated"), 0, 0);
		},
	});

	// ── Slash Commands ─────────────────────────────────────────────────────

	pi.registerCommand("captain", {
		description:
			"Show pipeline details (/captain <name>) or list all (/captain)",
		getArgumentCompletions: (prefix) =>
			Object.keys(pipelines)
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({ value: n, label: n })),
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				const names = Object.keys(pipelines);
				ctx.ui.notify(
					names.length > 0
						? `Pipelines: ${names.join(", ")}`
						: "No pipelines defined.",
					"info",
				);
				return;
			}

			const p = pipelines[name];
			if (!p) {
				ctx.ui.notify(`Pipeline "${name}" not found.`, "error");
				return;
			}

			ctx.ui.notify(
				`Pipeline "${name}":\n${describeRunnable(p.spec, 0)}`,
				"info",
			);
		},
	});

	pi.registerCommand("captain-agents", {
		description:
			"List all available agents (from .md files and runtime definitions)",
		handler: async (_args, ctx) => {
			const names = Object.keys(agents);
			if (names.length === 0) {
				ctx.ui.notify("No agents available.", "info");
				return;
			}
			const lines = names.map((n) => {
				const a = agents[n];
				const src = a.source === "md" ? "📄 md" : "⚡ runtime";
				return `• ${n} [${src}] — ${a.description} (tools: ${a.tools.join(", ")})`;
			});
			ctx.ui.notify(`Agents (${names.length}):\n${lines.join("\n")}`, "info");
		},
	});

	pi.registerCommand("captain-run", {
		description: "Quick-run a pipeline (/captain-run <name> <input>)",
		getArgumentCompletions: (prefix) =>
			Object.keys(pipelines)
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({ value: n, label: n })),
		handler: async (args, ctx) => {
			const parts = args?.trim().split(/\s+/) ?? [];
			const name = parts[0];
			const input = parts.slice(1).join(" ");

			if (!(name && input)) {
				ctx.ui.notify("Usage: /captain-run <name> <input>", "error");
				return;
			}

			if (!pipelines[name]) {
				ctx.ui.notify(`Pipeline "${name}" not found.`, "error");
				return;
			}

			// Send as user message to trigger the LLM to call pipeline_run
			pi.sendUserMessage(`Run pipeline "${name}" with input: ${input}`);
		},
	});

	pi.registerCommand("captain-load", {
		description:
			"Load a pipeline preset (/captain-load <name>). No args to list available presets.",
		getArgumentCompletions: (prefix, ctx) => {
			// Tab-complete from discovered presets
			const presets = discoverPresets(ctx.cwd);
			return presets
				.filter((p) => p.name.startsWith(prefix))
				.map((p) => ({ value: p.name, label: `${p.name} (${p.source})` }));
		},
		handler: async (args, ctx) => {
			const name = args?.trim();

			if (!name) {
				// List available presets
				const presets = discoverPresets(ctx.cwd);
				if (presets.length === 0) {
					ctx.ui.notify(
						"No pipeline presets found. Place .json files in .pi/pipelines/",
						"info",
					);
					return;
				}
				const lines = presets
					.map((p) => `• ${p.name} (${p.source})`)
					.join("\n");
				ctx.ui.notify(`Available presets:\n${lines}`, "info");
				return;
			}

			try {
				// Try builtin TS preset first, then project JSON
				let result: { name: string; agentCount: number; spec: Runnable };
				if (builtinPresetMap[name]) {
					result = loadBuiltinPreset(name);
				} else {
					const projectFile = join(ctx.cwd, ".pi", "pipelines", `${name}.json`);
					if (!existsSync(projectFile)) {
						ctx.ui.notify(
							`Preset "${name}" not found. Run /captain-load to see available presets.`,
							"error",
						);
						return;
					}
					result = loadPipelineFile(projectFile);
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

	pi.registerCommand("captain-generate", {
		description:
			"Generate a pipeline on-the-fly with LLM (/captain-generate <goal>)",
		handler: async (args, ctx) => {
			const goal = args?.trim();
			if (!goal) {
				ctx.ui.notify(
					"Usage: /captain-generate <what you want the pipeline to do>",
					"error",
				);
				return;
			}
			// Delegate to the LLM so it calls the captain_generate tool
			pi.sendUserMessage(
				`Generate a captain pipeline for this goal: ${goal}\n` +
					`Use captain_generate tool with goal="${goal}".`,
			);
		},
	});

	// ── Widget & Status Helpers ────────────────────────────────────────────

	/** Map step status to theme color name */
	function statusColor(status: string): string {
		if (status === "passed") return "success";
		if (status === "failed") return "error";
		return "dim";
	}

	/** Update the live widget showing pipeline progress */
	function updateWidget(ctx: ExtensionContext, state: PipelineState) {
		ctx.ui.setWidget("captain", (_tui, theme) => ({
			render(width: number): string[] {
				const elapsed = state.startTime
					? ((Date.now() - state.startTime) / 1000).toFixed(1)
					: "0";

				const lines: string[] = [
					theme.fg("accent", "─".repeat(width)),
					theme.fg("accent", theme.bold(`  🚀 Captain: ${state.name}`)) +
						theme.fg("dim", ` (${elapsed}s)`),
				];

				for (const r of state.results.slice(-6)) {
					const icon = statusIcon(r.status);
					const line = `  ${icon} ${r.label}: ${r.status} (${(r.elapsed / 1000).toFixed(1)}s)`;
					lines.push(theme.fg(statusColor(r.status), line));
				}

				if (state.results.length > 6) {
					lines.push(
						theme.fg("dim", `  … and ${state.results.length - 6} more steps`),
					);
				}
				lines.push(theme.fg("accent", "─".repeat(width)));
				return lines.map((l) => truncateToWidth(l, width));
			},
			invalidate() {},
		}));
	}

	/** Clear the pipeline widget */
	function clearWidget(ctx: ExtensionContext) {
		// Keep widget visible briefly so user can see final state
		setTimeout(() => ctx.ui.setWidget("captain", undefined), 3000);
	}

	pi.on("session_start", async (_e, ctx) => {
		ctx.ui.notify("🚀 Captain loaded — pipeline orchestration ready", "info");
	});
}

// ── Utility Functions ──────────────────────────────────────────────────────

/** Status icon for step results */
function statusIcon(status: string): string {
	switch (status) {
		case "passed":
			return "✓";
		case "failed":
			return "✗";
		case "skipped":
			return "⊘";
		case "running":
			return "⏳";
		default:
			return "○";
	}
}

/** Recursively collect all agent name references from a Runnable tree */
function collectAgentRefs(r: Runnable): string[] {
	switch (r.kind) {
		case "step":
			return [r.agent];
		case "sequential":
			return r.steps.flatMap(collectAgentRefs);
		case "pool":
			return collectAgentRefs(r.step);
		case "parallel":
			return r.steps.flatMap(collectAgentRefs);
		default:
			return [];
	}
}

/** Human-readable description of a Runnable tree */
function describeRunnable(r: Runnable, indent: number): string {
	const pad = " ".repeat(indent);

	switch (r.kind) {
		case "step":
			return `${pad}→ [step] "${r.label}" (agent: ${r.agent}, gate: ${r.gate.type}, onFail: ${r.onFail.action})`;

		case "sequential": {
			const gateInfo = r.gate
				? ` (gate: ${r.gate.type}, onFail: ${r.onFail?.action ?? "none"})`
				: "";
			return [
				`${pad}⟶ [sequential] (${r.steps.length} steps)${gateInfo}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");
		}

		case "pool": {
			const gateInfo = r.gate
				? ` (gate: ${r.gate.type}, onFail: ${r.onFail?.action ?? "none"})`
				: "";
			return [
				`${pad}⟳ [pool] ×${r.count} (merge: ${r.merge.strategy})${gateInfo}`,
				describeRunnable(r.step, indent + 2),
			].join("\n");
		}

		case "parallel": {
			const gateInfo = r.gate
				? ` (gate: ${r.gate.type}, onFail: ${r.onFail?.action ?? "none"})`
				: "";
			return [
				`${pad}⫸ [parallel] (${r.steps.length} branches, merge: ${r.merge.strategy})${gateInfo}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");
		}

		default:
			return `${pad}? unknown`;
	}
}
