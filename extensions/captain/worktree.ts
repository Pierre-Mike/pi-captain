// ── Git Worktree Isolation Helpers ─────────────────────────────────────────
import * as path from "node:path";

type ExecFn = (
	cmd: string,
	args: string[],
	opts?: { signal?: AbortSignal },
) => Promise<{
	stdout: string;
	stderr: string;
	code: number;
}>;

/** Check if the cwd is inside a git repo */
export async function isGitRepo(exec: ExecFn, cwd: string): Promise<boolean> {
	try {
		const { code } = await exec("git", [
			"-C",
			cwd,
			"rev-parse",
			"--is-inside-work-tree",
		]);
		return code === 0;
	} catch {
		return false;
	}
}

/** Create an isolated worktree for a parallel branch */
export async function createWorktree(
	exec: ExecFn,
	cwd: string,
	pipelineName: string,
	branchLabel: string,
	index: number,
	signal?: AbortSignal,
	/**
	 * Fix 2: optional pre-resolved hint — when provided the function skips its own
	 * `git rev-parse` subprocess, saving one round-trip per parallel branch.
	 */
	isGitRepoHint?: boolean,
): Promise<{ worktreePath: string; branchName: string } | null> {
	const gitRepo =
		isGitRepoHint !== undefined ? isGitRepoHint : await isGitRepo(exec, cwd);
	if (!gitRepo) return null;

	const sanitized = `${pipelineName}-${branchLabel}-${index}`.replace(
		/[^a-zA-Z0-9_-]/g,
		"_",
	);
	const worktreePath = path.join(cwd, ".worktrees", sanitized);
	const branchName = `captain/${sanitized}`;

	try {
		// Clean up any stale worktree/branch from a previous crashed run.
		// These are best-effort: the resource likely doesn't exist, so failures are expected and ignored.
		await exec(
			"git",
			["-C", cwd, "worktree", "remove", worktreePath, "--force"],
			{ signal },
		).catch(() => {});
		await exec("git", ["-C", cwd, "branch", "-D", branchName], {
			signal,
		}).catch(() => {});

		// Create worktree with a fresh branch based on HEAD
		await exec(
			"git",
			["-C", cwd, "worktree", "add", worktreePath, "-b", branchName],
			{ signal },
		);
		return { worktreePath, branchName };
	} catch (err) {
		// Real failure creating the worktree — surface it so callers can observe the problem.
		console.error(
			`[captain] Failed to create worktree "${worktreePath}" (branch: ${branchName}):`,
			err instanceof Error ? err.message : String(err),
		);
		return null;
	}
}

/** Remove a worktree and delete its branch */
export async function removeWorktree(
	exec: ExecFn,
	cwd: string,
	worktreePath: string,
	branchName: string,
	signal?: AbortSignal,
): Promise<void> {
	try {
		await exec(
			"git",
			["-C", cwd, "worktree", "remove", worktreePath, "--force"],
			{ signal },
		);
	} catch (err) {
		// Worktree may already be gone after a crash — only warn if it's an unexpected error
		const msg = err instanceof Error ? err.message : String(err);
		if (
			!(msg.includes("is not a working tree") || msg.includes("No such file"))
		) {
			console.warn(
				`[captain] worktree remove failed for "${worktreePath}": ${msg}`,
			);
		}
	}
	try {
		await exec("git", ["-C", cwd, "branch", "-D", branchName], { signal });
	} catch (err) {
		// Branch may already be deleted — only warn if it's an unexpected error
		const msg = err instanceof Error ? err.message : String(err);
		if (!(msg.includes("not found") || msg.includes("error: branch"))) {
			console.warn(
				`[captain] branch delete failed for "${branchName}": ${msg}`,
			);
		}
	}
}
