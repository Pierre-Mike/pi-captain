// ── CaptainState — All mutable runtime state and file I/O ─────────────────
// Encapsulates pipelines and in-memory state.

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { deserializeRunnable } from "./deserialize.js";
import * as builtinPipelines from "./pipelines/index.js";
import type { PipelineState, Runnable } from "./types.js";
import { describeRunnable } from "./utils/index.js";

export class CaptainState {
	pipelines: Record<string, { spec: Runnable }> = {};
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
	}

	// ── Preset Discovery & Loading ────────────────────────────────────────

	discoverPresets(): { name: string; source: "builtin" }[] {
		return Object.keys(this.builtinPresetMap).map((name) => ({
			name,
			source: "builtin",
		}));
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
		// Dynamic import — bun resolves .ts natively at runtime
		const mod = await import(filePath);
		const pipeline: Runnable = mod.pipeline ?? mod.default?.pipeline;
		if (!pipeline?.kind) {
			throw new Error(
				`Invalid TypeScript pipeline file: "${filePath}" must export a "pipeline" const of type Runnable`,
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

		const candidate = resolve(cwd, name);
		const filePath = existsSync(candidate)
			? candidate
			: existsSync(name)
				? resolve(name)
				: undefined;
		if (!filePath) return undefined;

		if (filePath.endsWith(".ts") || filePath.endsWith(".js")) {
			return this.loadTsPipelineFile(filePath);
		}
		return { ...this.loadPipelineFile(filePath), source: filePath };
	}

	// ── Pipeline List Helpers ─────────────────────────────────────────────

	buildPipelineListLines(): string[] {
		const names = Object.keys(this.pipelines);
		const lines = names.map((name) => {
			const p = this.pipelines[name];
			return `• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`;
		});
		this.appendUnloadedBuiltins(lines);
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
}
