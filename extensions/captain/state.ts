// ── CaptainState — Runtime state & pipeline registry (shell layer) ────────
// Coordinates infra (fs, dynamic import) with core logic.
// Follows the Impureim Sandwich: read → compute → write.

import { basename, join, resolve } from "node:path";
import {
	buildContractContent,
	pipelineNamesFromFiles,
} from "./core/contract.js";
import type { FsPort } from "./core/ports.js";
import type { PipelineState, Runnable } from "./core/types.js";
import { describeRunnable } from "./core/utils/index.js";
import { realFs } from "./infra/fs.js";
import { loadTsPipelineFile } from "./shell/ts-loader.js";

// ── Job Registry ──────────────────────────────────────────────────────────

/** A tracked pipeline execution — background or blocking. */
export interface CaptainJob {
	readonly id: number;
	readonly state: PipelineState;
	readonly controller: AbortController;
}

export class CaptainState {
	pipelines: Record<string, { spec: Runnable }> = {};

	/** All tracked jobs (running, completed, failed, cancelled). */
	jobs: Map<number, CaptainJob> = new Map();
	private _nextJobId = 1;

	readonly captainDir: string;

	/** Injected filesystem adapter — swap out in tests with a fake. */
	private readonly fs: FsPort;

	constructor(captainDir: string, fs: FsPort = realFs) {
		this.captainDir = captainDir.replace(/\/+$/, "");
		this.fs = fs;
	}

	// ── Job Registry ──────────────────────────────────────────────────────

	/** Backward compat: most recent running job's state, or last job overall. */
	get runningState(): PipelineState | null {
		const all = [...this.jobs.values()];
		for (let i = all.length - 1; i >= 0; i--) {
			if (all[i].state.status === "running") return all[i].state;
		}
		return all.at(-1)?.state ?? null;
	}

	/** Register a new job and assign it an auto-incremented ID. */
	allocateJob(pipelineState: PipelineState): CaptainJob {
		const id = this._nextJobId++;
		const controller = new AbortController();
		pipelineState.jobId = id;
		const job: CaptainJob = { id, state: pipelineState, controller };
		this.jobs.set(id, job);
		return job;
	}

	/** Abort a running job. Returns a result string describing the outcome. */
	killJob(id: number): "killed" | "not-found" | "not-running" {
		const job = this.jobs.get(id);
		if (!job) return "not-found";
		if (job.state.status !== "running") return "not-running";
		job.controller.abort();
		job.state.status = "cancelled";
		job.state.endTime = Date.now();
		return "killed";
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

	discoverPresets(cwd?: string): { name: string; source: string }[] {
		// Impure: read directory
		const piPipelinesDir = join(cwd ?? process.cwd(), ".pi", "pipelines");
		if (!this.fs.exists(piPipelinesDir)) return [];

		const userFiles = this.fs.listFiles(piPipelinesDir);
		return userFiles
			.filter((f) => f !== "captain.ts" && f.endsWith(".ts"))
			.map((f) => ({
				name: basename(f, ".ts"),
				source: join(piPipelinesDir, f),
			}));
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
	): Promise<{ name: string; spec: Runnable; source?: string }> | undefined {
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
			const p = join(piDir, `${name}.ts`);
			if (this.fs.exists(p)) filePath = p;
		}

		if (!filePath) return undefined;

		return this.loadTsPipelineFile(filePath);
	}

	// ── Pipeline List Helpers ─────────────────────────────────────────────
	buildPipelineListLines(cwd?: string): string[] {
		// Pure: loaded pipelines
		const loaded = Object.entries(this.pipelines).map(
			([name, p]) => `• ${name} (loaded)\n${describeRunnable(p.spec, 2)}`,
		);

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
		return [...loaded, ...userSection];
	}
}
