// ── CaptainState — Runtime state & pipeline registry (shell layer) ────────
// Coordinates infra (fs, dynamic import) with core logic.
// Follows the Impureim Sandwich: read → compute → write.

import { basename, join, resolve } from "node:path";
import {
	buildContractContent,
	pipelineNamesFromFiles,
} from "./core/contract.js";
import { deserializeRunnable } from "./core/deserialize.js";
import { describeRunnable } from "./core/utils/index.js";
import { realFs } from "./infra/fs.js";
import * as builtinPipelines from "./pipelines/index.js";
import type { FsPort } from "./ports.js";
import { loadTsPipelineFile } from "./shell/ts-loader.js";
import type { PipelineState, Runnable } from "./types.js";

export class CaptainState {
	pipelines: Record<string, { spec: Runnable }> = {};
	runningState: PipelineState | null = null;

	readonly builtinPresetMap: Record<string, { pipeline: Runnable }>;
	readonly captainDir: string;

	/** Injected filesystem adapter — swap out in tests with a fake. */
	private readonly fs: FsPort;

	constructor(captainDir: string, fs: FsPort = realFs) {
		this.captainDir = captainDir.replace(/\/+$/, "");
		this.fs = fs;
		this.builtinPresetMap = {};
		for (const [key, mod] of Object.entries(builtinPipelines)) {
			const kebab = key.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
			const name = `captain:${kebab}`;
			this.builtinPresetMap[name] = { pipeline: mod.pipeline };
		}
	}

	// ── Contract File ─────────────────────────────────────────────────────

	ensureCaptainContractFile(cwd: string): void {
		const piDir = join(cwd, ".pi", "pipelines");
		if (!this.fs.exists(piDir)) this.fs.mkdirp(piDir);

		const contractPath = join(piDir, "captain.ts");
		const apiPath = join(this.captainDir, "api.ts");

		// Pure computation (core)
		const content = buildContractContent(apiPath);

		// Read → compare → write only if stale (shell)
		if (this.fs.exists(contractPath)) {
			const existing = this.fs.readText(contractPath);
			if (existing === content) return;
		}
		this.fs.writeText(contractPath, content);
	}

	// ── Preset Discovery & Loading ────────────────────────────────────────

	discoverPresets(
		cwd?: string,
	): { name: string; source: "builtin" | string }[] {
		// Pure: map builtins
		const builtins = Object.keys(this.builtinPresetMap).map((name) => ({
			name,
			source: "builtin" as const,
		}));

		// Impure: read directory
		const piPipelinesDir = join(cwd ?? process.cwd(), ".pi", "pipelines");
		if (!this.fs.exists(piPipelinesDir)) return builtins;

		const userFiles = this.fs.listFiles(piPipelinesDir);
		const userPresets = userFiles
			.filter(
				(f) => f !== "captain.ts" && (f.endsWith(".ts") || f.endsWith(".json")),
			)
			.map((f) => ({
				name: basename(f, f.endsWith(".ts") ? ".ts" : ".json"),
				source: join(piPipelinesDir, f),
			}));

		return [...builtins, ...userPresets];
	}

	loadBuiltinPreset(name: string): { name: string; spec: Runnable } {
		const preset = this.builtinPresetMap[name];
		if (!preset) throw new Error(`Builtin preset "${name}" not found`);
		this.pipelines[name] = { spec: preset.pipeline };
		return { name, spec: preset.pipeline };
	}

	loadPipelineFile(filePath: string): { name: string; spec: Runnable } {
		// read (infra)
		const raw = this.fs.readText(filePath);
		// compute (core)
		const data = JSON.parse(raw) as { pipeline: Runnable };
		if (!data.pipeline?.kind) {
			throw new Error(
				"Invalid pipeline file: missing 'pipeline' with 'kind' field",
			);
		}
		const name = basename(filePath, ".json");
		const spec = deserializeRunnable(data.pipeline);
		// write state (shell)
		this.pipelines[name] = { spec };
		return { name, spec };
	}

	loadTsPipelineFile(
		filePath: string,
	): Promise<{ name: string; spec: Runnable; source: string }> {
		return loadTsPipelineFile(
			filePath,
			this.captainDir,
			this.pipelines,
			this.fs,
		);
	}

	resolvePreset(
		name: string,
		cwd: string,
	):
		| Promise<{ name: string; spec: Runnable; source?: string }>
		| { name: string; spec: Runnable; source?: string }
		| undefined {
		if (this.builtinPresetMap[name]) return this.loadBuiltinPreset(name);

		// Resolve by explicit file path
		const candidate = resolve(cwd, name);
		let filePath = this.fs.exists(candidate)
			? candidate
			: this.fs.exists(name)
				? resolve(name)
				: undefined;

		// Auto-discover from .pi/pipelines/
		if (!filePath) {
			const piDir = join(cwd, ".pi", "pipelines");
			for (const ext of [".ts", ".json"]) {
				const p = join(piDir, `${name}${ext}`);
				if (this.fs.exists(p)) {
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
	buildPipelineListLines(cwd?: string): string[] {
		// Pure: loaded pipelines
		const loaded = Object.entries(this.pipelines).map(
			([name, p]) => `• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`,
		);

		// Pure: unloaded builtins
		const unloadedBuiltins = Object.keys(this.builtinPresetMap)
			.filter((n) => !this.pipelines[n])
			.map((n) => `  • ${n} (builtin)`);

		const builtinSection =
			unloadedBuiltins.length > 0
				? [
						"",
						"Available builtin presets (captain_load to activate):",
						...unloadedBuiltins,
					]
				: [];

		// Impure: user pipeline discovery
		const userSection: string[] = [];
		if (cwd) {
			const piDir = join(cwd, ".pi", "pipelines");
			if (this.fs.exists(piDir)) {
				const files = this.fs.listFiles(piDir);
				const names = pipelineNamesFromFiles(files).filter(
					(n) => !this.pipelines[n],
				);
				if (names.length > 0) {
					userSection.push(
						"",
						"User pipelines in .pi/pipelines/ (captain_load to activate):",
						...names.map((n) => `  • ${n} (.pi/pipelines/)`),
					);
				}
			}
		}
		return [...loaded, ...builtinSection, ...userSection];
	}
}
