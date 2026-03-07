// ── CaptainState — All mutable runtime state and file I/O ─────────────────
// Encapsulates pipelines, agents, and session reconstruction in one place.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as builtinPipelines from "./pipelines/index.js";
import type {
	Agent,
	AgentName,
	CaptainDetails,
	PipelineState,
	Runnable,
} from "./types.js";
import { parseFrontmatter } from "./utils/frontmatter.js";
import { collectAgentRefs, describeRunnable } from "./utils/index.js";

const baseDir = (() => {
	try {
		return new URL(".", import.meta.url).pathname;
	} catch {
		return process.cwd();
	}
})();

const AGENT_DIRS = [
	join(baseDir, "agents"), // bundled with pi-captain repo
	join(homedir(), ".pi", "agent", "agents"), // pi global
	join(homedir(), ".claude", "agents"), // Claude Code global
];

const CAPTAIN_TOOLS = new Set([
	"captain_define",
	"captain_load",
	"captain_run",
	"captain_list",
	"captain_status",
	"captain_agent",
	"captain_generate",
]);

export class CaptainState {
	pipelines: Record<string, { spec: Runnable }> = {};
	agents: Record<string, Agent> = {};
	runningState: PipelineState | null = null;

	/** Built-in pipeline registry from pipelines/*.ts modules */
	readonly builtinPresetMap: Record<string, { pipeline: Runnable }>;

	constructor() {
		this.builtinPresetMap = {};
		for (const [key, mod] of Object.entries(builtinPipelines)) {
			const kebab = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
			const name = `captain:${kebab}`;
			this.builtinPresetMap[name] = { pipeline: mod.pipeline };
		}
		this.loadMdAgents();
	}

	// ── Snapshot ─────────────────────────────────────────────────────────

	snapshot(lastRun?: PipelineState): CaptainDetails {
		return {
			pipelines: { ...this.pipelines },
			agents: { ...this.agents },
			lastRun: lastRun
				? { name: lastRun.name, state: { ...lastRun } }
				: undefined,
		};
	}

	// ── Agent Discovery ───────────────────────────────────────────────────

	private findMdFiles(dir: string): string[] {
		if (!existsSync(dir)) return [];
		const files: string[] = [];
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			try {
				if (statSync(full).isDirectory()) files.push(...this.findMdFiles(full));
				else if (entry.endsWith(".md")) files.push(full);
			} catch {
				/* skip unreadable */
			}
		}
		return files;
	}

	parseMdAgent(filePath: string): Agent | null {
		const content = readFileSync(filePath, "utf-8");
		const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!fmMatch) return null;

		const fm = parseFrontmatter(fmMatch[1]);
		const body = content.slice(fmMatch[0].length).trim();
		const name =
			typeof fm.name === "string" ? fm.name : basename(filePath, ".md");

		let tools: string[] = [];
		if (Array.isArray(fm.tools)) {
			tools = fm.tools.map((t) => String(t).trim());
		} else if (typeof fm.tools === "string") {
			tools = fm.tools.split(",").map((t) => t.trim());
		}

		const model = typeof fm.model === "string" ? fm.model : undefined;
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

	private shouldRegisterAgent(name: string): boolean {
		return !this.agents[name] || this.agents[name].source !== "runtime";
	}

	loadMdAgents(cwd?: string) {
		const dirs = [...AGENT_DIRS];
		if (cwd) {
			dirs.push(join(cwd, "agents"));
			dirs.push(join(cwd, ".pi", "agents"));
			dirs.push(join(cwd, ".claude", "agents"));
		}
		for (const dir of dirs) {
			for (const filePath of this.findMdFiles(dir)) {
				const agent = this.parseMdAgent(filePath);
				if (!agent) continue;
				if (this.shouldRegisterAgent(agent.name))
					this.agents[agent.name] = agent;
			}
		}
	}

	// ── Pipeline File I/O ─────────────────────────────────────────────────

	savePipelineToFile(name: string, spec: Runnable, cwd: string): string {
		const pipelinesDir = join(cwd, ".pi", "pipelines");
		mkdirSync(pipelinesDir, { recursive: true });

		const refNames = [...new Set(collectAgentRefs(spec))];
		const referencedAgents: Record<string, Agent> = {};
		for (const agentName of refNames) {
			if (this.agents[agentName])
				referencedAgents[agentName] = this.agents[agentName];
		}

		const filePath = join(pipelinesDir, `${name}.json`);
		writeFileSync(
			filePath,
			JSON.stringify(
				{ name, agents: referencedAgents, pipeline: spec },
				null,
				2,
			),
			"utf-8",
		);
		return filePath;
	}

	// ── Preset Discovery & Loading ────────────────────────────────────────

	discoverPresets(
		cwd: string,
	): { name: string; source: "builtin" | "project" }[] {
		const presets: { name: string; source: "builtin" | "project" }[] = [];
		for (const name of Object.keys(this.builtinPresetMap)) {
			presets.push({ name, source: "builtin" });
		}
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

	loadBuiltinPreset(name: string): {
		name: string;
		agentCount: number;
		spec: Runnable;
	} {
		const preset = this.builtinPresetMap[name];
		if (!preset) throw new Error(`Builtin preset "${name}" not found`);
		this.pipelines[name] = { spec: preset.pipeline };
		const referencedAgents = collectAgentRefs(preset.pipeline);
		return {
			name,
			agentCount: [...new Set(referencedAgents)].length,
			spec: preset.pipeline,
		};
	}

	loadPipelineFile(filePath: string): {
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
			this.agents[key] = { ...agent, name: key as AgentName };
		}
		const name = basename(filePath, ".json");
		this.pipelines[name] = { spec: data.pipeline };
		return { name, agentCount: agentEntries.length, spec: data.pipeline };
	}

	resolvePreset(
		name: string,
		cwd: string,
	):
		| { name: string; agentCount: number; spec: Runnable; source?: string }
		| undefined {
		if (this.builtinPresetMap[name]) return this.loadBuiltinPreset(name);

		const projectFile = join(cwd, ".pi", "pipelines", `${name}.json`);
		if (existsSync(projectFile)) return this.loadPipelineFile(projectFile);

		const candidate = resolve(cwd, name);
		const filePath = existsSync(candidate)
			? candidate
			: existsSync(name)
				? resolve(name)
				: undefined;
		if (filePath) {
			const result = this.loadPipelineFile(filePath);
			return { ...result, source: filePath };
		}
		return undefined;
	}

	// ── Session Reconstruction ────────────────────────────────────────────

	private applyCaptainDetails(d: CaptainDetails): void {
		this.pipelines = d.pipelines ?? this.pipelines;
		this.agents = d.agents ?? this.agents;
		if (d.lastRun) this.runningState = d.lastRun.state;
	}

	reconstruct(ctx: ExtensionContext): void {
		this.pipelines = {};
		this.agents = {};
		this.runningState = null;

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || entry.message.role !== "toolResult")
				continue;
			if (!CAPTAIN_TOOLS.has(entry.message.toolName)) continue;
			const d = entry.message.details as CaptainDetails | undefined;
			if (d) this.applyCaptainDetails(d);
		}
		this.loadMdAgents(ctx.cwd);
	}

	// ── Pipeline List Helpers ─────────────────────────────────────────────

	buildPipelineListLines(cwd: string): string[] {
		const names = Object.keys(this.pipelines);
		const lines = names.map((name) => {
			const p = this.pipelines[name];
			return `• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`;
		});
		this.appendUnloadedBuiltins(lines);
		this.appendUnloadedProjectPresets(lines, cwd);
		return lines;
	}

	private appendUnloadedBuiltins(lines: string[]): void {
		const unloaded = Object.keys(this.builtinPresetMap).filter(
			(n) => !this.pipelines[n],
		);
		if (unloaded.length === 0) return;
		lines.push("");
		lines.push("Available presets (use captain_load to activate):");
		for (const name of unloaded) lines.push(`  • ${name} (builtin)`);
	}

	private appendUnloadedProjectPresets(lines: string[], cwd: string): void {
		const projectDir = join(cwd, ".pi", "pipelines");
		if (!existsSync(projectDir)) return;
		const unloadedJson = readdirSync(projectDir)
			.filter((f) => f.endsWith(".json"))
			.map((f) => basename(f, ".json"))
			.filter((n) => !this.pipelines[n]);
		if (unloadedJson.length === 0) return;
		lines.push("  Project presets:");
		for (const name of unloadedJson) lines.push(`  • ${name} (project)`);
	}
}
