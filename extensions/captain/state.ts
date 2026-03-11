// ── CaptainState — All mutable runtime state and file I/O ─────────────────
// Encapsulates pipelines and in-memory state.

import {
	existsSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { deserializeRunnable } from "./deserialize.js";
import * as builtinPipelines from "./pipelines/index.js";
import type { PipelineState, Runnable } from "./types.js";
import { describeRunnable } from "./utils/index.js";

export class CaptainState {
	pipelines: Record<string, { spec: Runnable }> = {};
	runningState: PipelineState | null = null;

	/** Built-in pipeline registry from pipelines/*.ts modules */
	readonly builtinPresetMap: Record<string, { pipeline: Runnable }>;

	/** Absolute path to the captain extension directory (for <captain> alias resolution) */
	readonly captainDir: string;

	constructor(captainDir: string) {
		this.captainDir = captainDir.replace(/\/+$/, ""); // strip trailing slash
		this.builtinPresetMap = {};
		for (const [key, mod] of Object.entries(builtinPipelines)) {
			const kebab = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
			const name = `captain:${kebab}`;
			this.builtinPresetMap[name] = { pipeline: mod.pipeline };
		}
	}

	// ── Preset Discovery & Loading ────────────────────────────────────────

	discoverPresets(
		cwd?: string,
	): { name: string; source: "builtin" | string }[] {
		const results: { name: string; source: "builtin" | string }[] = [];

		// Built-in presets from pipelines/*.ts modules
		for (const name of Object.keys(this.builtinPresetMap)) {
			results.push({ name, source: "builtin" });
		}

		// User pipelines from .pi/pipelines/ (TS and JSON)
		const piPipelinesDir = join(cwd ?? process.cwd(), ".pi", "pipelines");
		if (existsSync(piPipelinesDir)) {
			for (const file of readdirSync(piPipelinesDir)) {
				if (file.endsWith(".ts") || file.endsWith(".json")) {
					const ext = file.endsWith(".ts") ? ".ts" : ".json";
					const name = basename(file, ext);
					results.push({ name, source: join(piPipelinesDir, file) });
				}
			}
		}

		return results;
	}

	loadBuiltinPreset(name: string): { name: string; spec: Runnable } {
		const preset = this.builtinPresetMap[name];
		if (!preset) throw new Error(`Builtin preset "${name}" not found`);
		this.pipelines[name] = { spec: preset.pipeline };
		return { name, spec: preset.pipeline };
	}

	loadPipelineFile(filePath: string): { name: string; spec: Runnable } {
		const raw = readFileSync(filePath, "utf-8");
		const data = JSON.parse(raw) as { pipeline: Runnable };
		if (!data.pipeline?.kind) {
			throw new Error(
				"Invalid pipeline file: missing 'pipeline' with 'kind' field",
			);
		}
		const name = basename(filePath, ".json");
		// Deserialize JSON gate/onFail objects into their function equivalents
		const spec = deserializeRunnable(data.pipeline);
		this.pipelines[name] = { spec };
		return { name, spec };
	}

	async loadTsPipelineFile(filePath: string): Promise<{
		name: string;
		spec: Runnable;
		source: string;
	}> {
		// Resolve <captain>/ and captain/ aliases: replace all occurrences with the absolute
		// path to the captain extension directory so that external pipeline
		// files (e.g. in .pi/pipelines/) can use the documented aliases without
		// needing to know the install location.
		const raw = readFileSync(filePath, "utf-8");
		const captainAliasBrackets = `"<captain>/`;
		const captainAliasNoBrackets = `"captain/`;
		const needsAlias =
			raw.includes(captainAliasBrackets) ||
			raw.includes(captainAliasNoBrackets);

		let importPath = filePath;

		if (needsAlias) {
			let resolved = raw.replaceAll(
				captainAliasBrackets,
				`"${this.captainDir}/`,
			);
			resolved = resolved.replaceAll(
				captainAliasNoBrackets,
				`"${this.captainDir}/`,
			);
			// Write a temp file so Bun can import it with correct paths
			const tmpFile = join(tmpdir(), `captain-pipeline-${Date.now()}.ts`);
			writeFileSync(tmpFile, resolved, "utf-8");
			importPath = tmpFile;
		}

		// Dynamic import — bun resolves .ts natively at runtime.
		// If we wrote a temp file for alias resolution, clean it up afterwards.
		let mod: Record<string, unknown>;
		try {
			mod = await import(importPath);
		} finally {
			if (needsAlias) {
				try {
					unlinkSync(importPath);
				} catch {
					/* best-effort */
				}
			}
		}
		const pipeline: Runnable =
			((mod as Record<string, { pipeline?: Runnable } & Runnable>)
				.pipeline as unknown as Runnable) ??
			(mod.default as { pipeline?: Runnable } | undefined)?.pipeline;
		if (!pipeline?.kind) {
			throw new Error(
				`Invalid TypeScript pipeline file: "${filePath}" must export a "pipeline" const of type Runnable.\n` +
					`Tip: ensure your file exports a "pipeline" const with a "kind" field (e.g. "sequential", "parallel", "pool").\n` +
					`If you used captain aliases, use either "<captain>/" or "captain/" (e.g. "<captain>/gates/on-fail.js" or "captain/gates/on-fail.js")`,
			);
		}
		const ext = filePath.endsWith(".ts") ? ".ts" : ".js";
		const name = basename(filePath, ext);
		this.pipelines[name] = { spec: pipeline };
		return { name, spec: pipeline, source: filePath };
	}

	resolvePreset(
		name: string,
		cwd: string,
	):
		| Promise<{ name: string; spec: Runnable; source?: string }>
		| { name: string; spec: Runnable; source?: string }
		| undefined {
		if (this.builtinPresetMap[name]) return this.loadBuiltinPreset(name);

		// Resolve by file path (explicit path provided)
		const candidate = resolve(cwd, name);
		let filePath = existsSync(candidate)
			? candidate
			: existsSync(name)
				? resolve(name)
				: undefined;

		// Auto-discover from .pi/pipelines/ if no explicit path matched
		if (!filePath) {
			const piDir = join(cwd, ".pi", "pipelines");
			for (const ext of [".ts", ".json"]) {
				const p = join(piDir, `${name}${ext}`);
				if (existsSync(p)) {
					filePath = p;
					break;
				}
			}
		}

		if (!filePath) return undefined;

		if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
			return this.loadTsPipelineFile(filePath);
		}
		return { ...this.loadPipelineFile(filePath), source: filePath };
	}

	// ── Pipeline List Helpers ─────────────────────────────────────────────

	private appendLoadedPipelines(lines: string[]): void {
		for (const name of Object.keys(this.pipelines)) {
			const p = this.pipelines[name];
			lines.push(`• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`);
		}
	}

	private appendUnloadedBuiltins(lines: string[]): void {
		const unloadedBuiltins = Object.keys(this.builtinPresetMap).filter(
			(n) => !this.pipelines[n],
		);
		if (unloadedBuiltins.length === 0) return;
		lines.push("");
		lines.push("Available builtin presets (captain_load to activate):");
		for (const name of unloadedBuiltins) lines.push(`  • ${name} (builtin)`);
	}

	private appendUserPipelines(lines: string[], cwd: string): void {
		const piDir = join(cwd, ".pi", "pipelines");
		if (!existsSync(piDir)) return;
		const stripExt = (f: string) =>
			basename(f, f.endsWith(".ts") ? ".ts" : ".json");
		const userFiles = readdirSync(piDir).filter(
			(f) =>
				(f.endsWith(".ts") || f.endsWith(".json")) &&
				!this.pipelines[stripExt(f)],
		);
		if (userFiles.length === 0) return;
		lines.push("");
		lines.push("User pipelines in .pi/pipelines/ (captain_load to activate):");
		for (const f of userFiles)
			lines.push(`  • ${stripExt(f)} (.pi/pipelines/${f})`);
	}

	buildPipelineListLines(cwd?: string): string[] {
		const lines: string[] = [];
		this.appendLoadedPipelines(lines);
		this.appendUnloadedBuiltins(lines);
		if (cwd) this.appendUserPipelines(lines, cwd);
		return lines;
	}
}
