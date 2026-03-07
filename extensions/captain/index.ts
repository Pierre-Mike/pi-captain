// ── Captain: Agent Orchestration Pipeline Extension ────────────────────────
// Composable, type-safe multi-agent pipelines with sequential, parallel, and
// pool execution patterns, git worktree isolation, gates, and merge strategies.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
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
import { Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
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
	// Auto-load agents from multiple directories so captain works with any setup:
	//   1. <extension>/agents/*.md       — bundled with pi-captain repo (lowest precedence)
	//   2. ~/.pi/agent/agents/*.md       — pi global agents
	//   3. ~/.claude/agents/*.md         — Claude Code global agents
	//   4. <project>/agents/*.md         — project-local agents
	//   5. <project>/.pi/agents/*.md     — project-local pi agents
	//   6. <project>/.claude/agents/*.md — project-local Claude Code agents
	// Later directories take precedence (project-local overrides global overrides bundled).

	const AGENT_DIRS = [
		join(baseDir, "agents"), // bundled with pi-captain repo
		join(homedir(), ".pi", "agent", "agents"), // pi global
		join(homedir(), ".claude", "agents"), // Claude Code global
	];

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

	/** Parse a .md agent file → Agent object (returns null if invalid).
	 *  Supports any provider's agent .md format with YAML frontmatter.
	 *  Recognized fields: name, description, tools, model, temperature, color, skills. */
	function parseMdAgent(filePath: string): Agent | null {
		const content = readFileSync(filePath, "utf-8");
		const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!fmMatch) return null;

		const fm = parseFrontmatter(fmMatch[1]);
		const body = content.slice(fmMatch[0].length).trim();

		// Name is required — fall back to filename without extension
		const name =
			typeof fm.name === "string" ? fm.name : basename(filePath, ".md");

		// Tools: accept string[], comma-separated string, or missing
		let tools: string[] = [];
		if (Array.isArray(fm.tools)) {
			tools = fm.tools.map((t) => String(t).trim());
		} else if (typeof fm.tools === "string") {
			tools = fm.tools.split(",").map((t) => t.trim());
		}

		// Model: string identifier (e.g. "sonnet", "flash", "opus", "gpt-4o")
		const model = typeof fm.model === "string" ? fm.model : undefined;

		// Temperature: number between 0 and 1
		const temperature =
			typeof fm.temperature === "number" ? fm.temperature : undefined;

		return {
			name: name as AgentName,
			description: typeof fm.description === "string" ? fm.description : "",
			tools,
			model,
			temperature,
			systemPrompt: body || undefined,
			source: "md",
		};
	}

	/** Returns true when a newly-discovered agent should overwrite an existing entry.
	 *  Runtime-defined agents always take precedence over .md file agents. */
	function shouldRegisterAgent(name: string): boolean {
		return !agents[name] || agents[name].source !== "runtime";
	}

	/** Discover and register all .md agent files from all known directories.
	 *  Load order: global dirs first, then project-local dirs (later overrides earlier).
	 *  Runtime-defined agents always take precedence. */
	function loadMdAgents(cwd?: string) {
		// Build the search path: global dirs + project-local dirs
		const dirs = [...AGENT_DIRS];
		if (cwd) {
			dirs.push(join(cwd, "agents")); // <project>/agents/
			dirs.push(join(cwd, ".pi", "agents")); // <project>/.pi/agents/
			dirs.push(join(cwd, ".claude", "agents")); // <project>/.claude/agents/
		}

		for (const dir of dirs) {
			for (const filePath of findMdFiles(dir)) {
				const agent = parseMdAgent(filePath);
				if (!agent) continue;
				if (shouldRegisterAgent(agent.name)) agents[agent.name] = agent;
			}
		}
	}

	// Load global .md agents immediately on extension init
	loadMdAgents();

	// ── Auto-Save Pipelines to .pi/pipelines/ ──────────────────────────────
	// Persists every pipeline as a JSON file so humans can review and reuse them.

	/** Save a pipeline spec (with referenced agents) to .pi/pipelines/<name>.json */
	function savePipelineToFile(
		name: string,
		spec: Runnable,
		cwd: string,
	): string {
		const pipelinesDir = join(cwd, ".pi", "pipelines");
		mkdirSync(pipelinesDir, { recursive: true });

		// Collect only the agents referenced by this pipeline
		const refNames = [...new Set(collectAgentRefs(spec))];
		const referencedAgents: Record<string, Agent> = {};
		for (const agentName of refNames) {
			if (agents[agentName]) {
				referencedAgents[agentName] = agents[agentName];
			}
		}

		const payload = {
			name,
			agents: referencedAgents,
			pipeline: spec,
		};

		const filePath = join(pipelinesDir, `${name}.json`);
		writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
		return filePath;
	}

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

		loadMdAgents(ctx.cwd);
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
	 *  All builtins are prefixed with "captain:" to avoid collisions with user pipelines.
	 *  Agents are bundled in extensions/captain/agents/ — no external dependency needed. */
	const builtinPresetMap: Record<string, { pipeline: Runnable }> = {};
	for (const [key, mod] of Object.entries(builtinPipelines)) {
		// Convert camelCase export name to kebab-case, then prefix with "captain:"
		const kebab = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
		const name = `captain:${kebab}`;
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

	/** Load a built-in TS preset by name (e.g. "captain:shredder") → register its pipeline.
	 *  Agents are bundled in extensions/captain/agents/ and loaded at init. */
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
			"Step shape: { kind: 'step', label, prompt, gate, onFail, transform, ...config }",
			"  - prompt supports $INPUT (previous output) and $ORIGINAL (user request)",
			"  - agent?: named agent (optional — inline fields below override agent defaults)",
			"  - model?: 'sonnet'|'flash'|...  tools?: ['read','bash',...]  systemPrompt?: '...'",
			"  - skills?: ['path/to/skill.md']  extensions?: ['path/to/ext.ts']",
			"  - jsonOutput?: true  → passes --mode json to pi (step output is structured JSON)",
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

		async execute(_id, params, _signal, _onUpdate, ctx) {
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

				// Warn (but don't block) if any named agents are unknown
				const unknownAgents = collectAgentRefs(spec).filter(
					(name) => !agents[name],
				);
				const warning =
					unknownAgents.length > 0
						? `\n⚠️  Unknown agent(s): ${unknownAgents.join(", ")} — make sure they are defined before running.`
						: "";

				pipelines[params.name] = { spec };

				// Auto-save to .pi/pipelines/ for human review and reuse
				const savedPath = savePipelineToFile(params.name, spec, ctx.cwd);

				const summary = describeRunnable(spec, 0);
				return {
					content: [
						{
							type: "text",
							text: `Captain pipeline "${params.name}" defined:${warning}\n${summary}\n\n💾 Saved to ${savedPath}`,
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

			// Reload agents including project-local dirs before each run
			loadMdAgents(ctx.cwd);

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
				onStepStart: (label) => {
					state.currentStep = label;
					state.currentStepStream = undefined;
					updateWidget(ctx, state);
					onUpdate?.({
						content: [{ type: "text", text: `⏳ Running step: ${label}...` }],
					});
					ctx.ui.setStatus("captain", `🚀 ${params.name} → ${label}`);
				},
				onStepStream: (text) => {
					state.currentStepStream = text;
					updateWidget(ctx, state);
				},
				onStepEnd: (result) => {
					state.currentStep = undefined;
					state.currentStepStream = undefined;
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

				// Auto-save to .pi/pipelines/ for human review and reuse
				const savedPath = savePipelineToFile(
					generated.name,
					generated.pipeline,
					ctx.cwd,
				);

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
								`💾 Saved to ${savedPath}`,
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
					theme.fg("dim", "— ") +
					theme.fg(
						"muted",
						`"${(args.goal as string).slice(0, 50)}${(args.goal as string).length > 50 ? "…" : ""}"`,
					),
				0,
				0,
			),
		renderResult: (result, { isPartial }, theme) => {
			if (isPartial)
				return new Text(theme.fg("accent", "● Generating pipeline..."), 0, 0);
			if (result.isError)
				return new Text(theme.fg("error", "✗ Generation failed"), 0, 0);
			return new Text(theme.fg("success", "✓ Pipeline generated"), 0, 0);
		},
	});

	// ── Slash Commands ─────────────────────────────────────────────────────

	pi.registerCommand("captain", {
		description:
			"Show pipeline details (/captain <name>) or list all (/captain)",
		getArgumentCompletions: (prefix) => {
			// Tab-complete from both loaded pipelines and available presets
			const presets = discoverPresets(process.cwd());
			const allNames = new Set([
				...Object.keys(pipelines),
				...presets.map((p) => p.name),
			]);
			return [...allNames]
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({
					value: n,
					label: pipelines[n]
						? n
						: `${n} (${presets.find((p) => p.name === n)?.source ?? "preset"})`,
				}));
		},
		handler: async (args, ctx) => {
			const name = args?.trim();
			if (!name) {
				// Show loaded pipelines + all available (unloaded) presets
				const lines = buildPipelineListLines(ctx.cwd);
				ctx.ui.notify(
					lines.length > 0
						? lines.join("\n")
						: "No pipelines defined or available.",
					"info",
				);
				return;
			}

			// Show detail for a specific pipeline — load preset on-the-fly if needed
			const p = pipelines[name];
			if (p) {
				ctx.ui.notify(
					`Pipeline "${name}":\n${describeRunnable(p.spec, 0)}`,
					"info",
				);
				return;
			}

			// Try resolving as a preset so we can show its structure without running it
			try {
				const resolved = resolvePreset(name, ctx.cwd);
				if (resolved) {
					ctx.ui.notify(
						`Pipeline "${name}" (${resolved.source ?? "preset"} — not yet loaded):\n${describeRunnable(resolved.spec, 0)}`,
						"info",
					);
					return;
				}
			} catch {
				/* fall through to not-found message */
			}

			ctx.ui.notify(`Pipeline "${name}" not found.`, "error");
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
		getArgumentCompletions: (prefix) => {
			// Tab-complete from discovered presets
			const presets = discoverPresets(process.cwd());
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
		if (status === "running") return "accent";
		return "dim";
	}

	/** Map step status to a single visual icon (agent-team style) */
	function statusDot(status: string): string {
		if (status === "passed") return "✓";
		if (status === "failed") return "✗";
		if (status === "skipped") return "⊘";
		if (status === "running") return "●";
		return "○";
	}

	/** Render a single step as a bordered card (agent-team style) */
	function renderStepCard(
		label: string,
		status: string,
		elapsed: number,
		detail: string,
		colWidth: number,
		// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
		theme: any,
	): string[] {
		const w = colWidth - 2; // inner width (minus border chars)
		const truncate = (s: string, max: number) =>
			s.length > max ? `${s.slice(0, max - 3)}...` : s;

		const color = statusColor(status);
		const dot = statusDot(status);
		const timeStr = elapsed > 0 ? ` ${elapsed.toFixed(1)}s` : "";

		const nameRaw = truncate(label, w - 1);
		const nameStr = theme.fg("accent", theme.bold(nameRaw));

		const statusRaw = `${dot} ${status}${timeStr}`;
		const statusStr = theme.fg(color, statusRaw);

		const detailRaw = truncate(detail, w - 1);
		const detailStr = theme.fg("muted", detailRaw);

		const top = `┌${"─".repeat(w)}┐`;
		const bot = `└${"─".repeat(w)}┘`;
		const border = (content: string, visLen: number) =>
			theme.fg("dim", "│") +
			content +
			" ".repeat(Math.max(0, w - visLen)) +
			theme.fg("dim", "│");

		return [
			theme.fg("dim", top),
			border(` ${nameStr}`, 1 + nameRaw.length),
			border(` ${statusStr}`, 1 + statusRaw.length),
			border(` ${detailStr}`, 1 + detailRaw.length),
			theme.fg("dim", bot),
		];
	}

	/** Render a grid of step cards into lines */
	function renderStepGrid(
		results: PipelineState["results"],
		currentStep: string | undefined,
		currentStepStream: string | undefined,
		width: number,
		// biome-ignore lint/suspicious/noExplicitAny: pi theme API is not typed
		theme: any,
	): string[] {
		// Last non-empty line of the stream as the live detail for the running card
		const streamDetail = currentStepStream
			? (currentStepStream
					.split("\n")
					.filter((l) => l.trim())
					.at(-1) ?? "")
			: "";
		// Combine completed results with a synthetic "running" entry for the active step
		const all: PipelineState["results"] = currentStep
			? [
					...results,
					{
						label: currentStep,
						status: "running",
						output: streamDetail,
						elapsed: 0,
					},
				]
			: results;

		if (all.length === 0) return [theme.fg("dim", "  Waiting for steps...")];

		const cols = Math.min(2, all.length);
		const gap = 1;
		const colWidth = Math.floor((width - gap * (cols - 1)) / cols);
		const lines: string[] = [];

		for (let i = 0; i < all.length; i += cols) {
			const rowSteps = all.slice(i, i + cols);
			const cards = rowSteps.map((r) =>
				renderStepCard(
					r.label,
					r.status,
					r.elapsed / 1000,
					r.error ?? r.output?.slice(0, 80) ?? "",
					colWidth,
					theme,
				),
			);
			while (cards.length < cols)
				cards.push(new Array(5).fill(" ".repeat(colWidth)));
			const cardHeight = cards[0].length;
			for (let line = 0; line < cardHeight; line++) {
				lines.push(cards.map((c) => c[line] ?? "").join(" ".repeat(gap)));
			}
		}

		return lines;
	}

	/** Update the live widget showing pipeline progress (grid of step cards) */
	function updateWidget(ctx: ExtensionContext, state: PipelineState) {
		ctx.ui.setWidget("captain", (_tui, theme) => {
			const text = new Text("", 0, 1);
			return {
				render(width: number): string[] {
					const elapsed = state.startTime
						? ((Date.now() - state.startTime) / 1000).toFixed(1)
						: "0";

					const headerLabel = `  Captain: ${state.name}`;
					const headerRight = `${elapsed}s `;
					const headerPad = " ".repeat(
						Math.max(1, width - headerLabel.length - headerRight.length),
					);
					const header =
						theme.fg("accent", theme.bold(headerLabel)) +
						headerPad +
						theme.fg("dim", headerRight);

					const lines: string[] = [
						theme.fg("accent", "─".repeat(width)),
						truncateToWidth(header, width),
						theme.fg("accent", "─".repeat(width)),
						...renderStepGrid(
							state.results,
							state.currentStep,
							state.currentStepStream,
							width,
							theme,
						),
					];

					text.setText(lines.join("\n"));
					return text.render(width);
				},
				invalidate() {
					text.invalidate();
				},
			};
		});
	}

	/** Clear the pipeline widget */
	function clearWidget(ctx: ExtensionContext) {
		// Keep widget visible briefly so user can see final state
		setTimeout(() => ctx.ui.setWidget("captain", undefined), 3000);
	}

	pi.on("session_start", async (_e, ctx) => {
		ctx.ui.notify(
			"Captain loaded — pipeline orchestration ready\n\n" +
				"/captain              List pipelines\n" +
				"/captain-agents       List available agents\n" +
				"/captain-load <name>  Load a preset\n" +
				"/captain-run <n> <i>  Quick-run a pipeline",
			"info",
		);

		// Footer: model | context bar
		ctx.ui.setFooter((_tui, theme, _footerData) => ({
			dispose: () => {},
			invalidate() {},
			render(width: number): string[] {
				const model = ctx.model?.id ?? "no-model";
				const usage = ctx.getContextUsage?.();
				const pct = usage ? usage.percent : 0;
				const filled = Math.round(pct / 10);
				const bar = "#".repeat(filled) + "-".repeat(10 - filled);

				const pipelineCount = Object.keys(pipelines).length;
				const agentCount = Object.keys(agents).length;
				const left =
					theme.fg("dim", ` ${model}`) +
					theme.fg("muted", " · ") +
					theme.fg("accent", `${pipelineCount} pipeline(s)`) +
					theme.fg("muted", " · ") +
					theme.fg("dim", `${agentCount} agent(s)`);
				const right = theme.fg("dim", `[${bar}] ${Math.round(pct)}% `);
				const pad = " ".repeat(
					Math.max(1, width - visibleWidth(left) - visibleWidth(right)),
				);

				return [truncateToWidth(left + pad + right, width)];
			},
		}));
	});
}

// ── Utility Functions ──────────────────────────────────────────────────────

// ── YAML Frontmatter Helpers ──────────────────────────────────────────────

/** Try to match a YAML list item line; returns the trimmed value or null. */
function parseListItem(line: string): string | null {
	const m = line.match(/^\s+-\s+(.+)/);
	return m ? m[1].trim() : null;
}

/**
 * Coerce a raw (already-unquoted) YAML scalar string to the right JS type.
 * Returns a boolean, number, string[], or string.
 */
function parseScalarValue(
	unquoted: string,
): string | string[] | number | boolean {
	if (unquoted === "true") return true;
	if (unquoted === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
	if (unquoted.includes(",")) return unquoted.split(",").map((s) => s.trim());
	return unquoted;
}

/** Flush a pending list accumulator into result. */
function flushPendingList(
	result: Record<string, string | string[] | number | boolean>,
	key: string,
	listItems: string[] | null,
): void {
	if (listItems && key) result[key] = listItems;
}

/**
 * Process a key-value line; updates result and returns the new currentKey.
 * Returns null if the line is not a key-value pair.
 */
function parseKeyValue(
	line: string,
	result: Record<string, string | string[] | number | boolean>,
): string | null {
	const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)/);
	if (!kvMatch) return null;
	const key = kvMatch[1];
	const rawValue = kvMatch[2].trim();
	// Empty value — could be followed by YAML list items
	if (rawValue) {
		const unquoted = rawValue.replace(/^["']|["']$/g, "");
		result[key] = parseScalarValue(unquoted);
	}
	return key;
}

/**
 * Parse YAML-style frontmatter into a key-value map.
 * Handles: scalar values, comma-separated lists, YAML list syntax (  - item),
 * quoted strings, numeric values, and multi-line descriptions.
 * No external YAML dependency — works with any provider's .md agent format.
 */
function parseFrontmatter(
	raw: string,
): Record<string, string | string[] | number | boolean> {
	const result: Record<string, string | string[] | number | boolean> = {};
	const lines = raw.split("\n");
	let currentKey = "";
	let listItems: string[] | null = null;

	for (const line of lines) {
		// YAML list item (  - value) — belongs to the current key
		const item = parseListItem(line);
		if (item !== null && currentKey) {
			if (!listItems) listItems = [];
			listItems.push(item);
			continue;
		}

		// Flush any pending list before processing the next key
		if (listItems && currentKey) {
			flushPendingList(result, currentKey, listItems);
			listItems = null;
		}

		// Key: value pair (top-level, no leading whitespace)
		const newKey = parseKeyValue(line, result);
		if (newKey !== null) currentKey = newKey;
	}

	// Flush final pending list
	flushPendingList(result, currentKey, listItems);

	return result;
}

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

/** Recursively collect all named agent references from a Runnable tree */
function collectAgentRefs(r: Runnable): string[] {
	switch (r.kind) {
		case "step":
			return r.agent ? [r.agent] : [];
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

/** Format the gate/onFail suffix for container runnables (sequential, pool, parallel) */
function containerGateInfo(
	gate: Gate | undefined,
	onFail: OnFail | undefined,
): string {
	return gate
		? ` (gate: ${gate.type}, onFail: ${onFail?.action ?? "none"})`
		: "";
}

/** Human-readable description of a Runnable tree */
function describeRunnable(r: Runnable, indent: number): string {
	const pad = " ".repeat(indent);

	switch (r.kind) {
		case "step": {
			const who = r.agent
				? `agent: ${r.agent}`
				: `model: ${r.model ?? "sonnet"}, tools: ${(r.tools ?? ["read", "bash", "edit", "write"]).join(",")}`;
			const json = r.jsonOutput ? ", json" : "";
			return `${pad}→ [step] "${r.label}" (${who}${json}, gate: ${r.gate.type}, onFail: ${r.onFail.action})`;
		}

		case "sequential":
			return [
				`${pad}⟶ [sequential] (${r.steps.length} steps)${containerGateInfo(r.gate, r.onFail)}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");

		case "pool":
			return [
				`${pad}⟳ [pool] ×${r.count} (merge: ${r.merge.strategy})${containerGateInfo(r.gate, r.onFail)}`,
				describeRunnable(r.step, indent + 2),
			].join("\n");

		case "parallel":
			return [
				`${pad}⫸ [parallel] (${r.steps.length} branches, merge: ${r.merge.strategy})${containerGateInfo(r.gate, r.onFail)}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");

		default:
			return `${pad}? unknown`;
	}
}
