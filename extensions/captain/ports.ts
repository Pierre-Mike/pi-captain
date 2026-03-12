// ── Ports — Dependency Interfaces (Basic_knowledge.md §Dependency Injection) ─
// These interfaces define the boundaries between the pure core and side-effectful
// infra adapters. The shell layer depends on these; infra layers implement them.
// No concrete imports from infra/ or shell/ belong here.

/** A minimal interface for running shell commands */
export interface ExecPort {
	exec(
		cmd: string,
		args: readonly string[],
		opts?: { signal?: AbortSignal },
	): Promise<{
		readonly stdout: string;
		readonly stderr: string;
		readonly code: number;
	}>;
}

/** File system read/write operations */
export interface FsPort {
	exists(path: string): boolean;
	readText(path: string): string;
	writeText(path: string, content: string): void;
	mkdirp(path: string): void;
	listFiles(dir: string): readonly string[];
	remove(path: string): void;
}

/** Worktree management */
export interface WorktreePort {
	create(
		cwd: string,
		pipelineName: string,
		label: string,
		index: number,
		signal?: AbortSignal,
		isGitRepo?: boolean,
	): Promise<{ worktreePath: string; branchName: string } | null>;
	remove(
		cwd: string,
		worktreePath: string,
		branchName: string,
		signal?: AbortSignal,
	): Promise<void>;
	isGitRepo(exec: ExecPort["exec"], cwd: string): Promise<boolean>;
}

/** Minimal LLM completion port */
export interface LlmPort {
	complete(prompt: string, signal?: AbortSignal): Promise<string>;
}
