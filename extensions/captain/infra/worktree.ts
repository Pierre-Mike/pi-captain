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

	const sanitized =
		`${pipelineName}-${branchLabel}-${index}-${process.pid}`.replace(
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
		).catch((_e: unknown) => {
			/* best-effort cleanup — ignore errors */
		});
		await exec("git", ["-C", cwd, "branch", "-D", branchName], {
			signal,
		}).catch((_e: unknown) => {
			/* best-effort cleanup — ignore errors */
		});

		// Create worktree with a fresh branch based on HEAD
		await exec(
			"git",
			["-C", cwd, "worktree", "add", worktreePath, "-b", branchName],
			{ signal },
		);
		return { worktreePath, branchName };
	} catch (err) {
		// Real failure creating the worktree — surface it so callers can observe the problem.
		// biome-ignore lint/suspicious/noConsole: intentional diagnostic output for worktree failures
		console.error(
			`[captain] Failed to create worktree "${worktreePath}" (branch: ${branchName}):`,
			err instanceof Error ? err.message : String(err),
		);
		return null;
	}
}

/**
 * Commit all changes in a worktree if there are any.
 * Returns true if a commit was made, false if the worktree was clean.
 * Pass failed=true to mark the commit as a failed-step recovery snapshot.
 */
export async function commitWorktreeChanges(
	exec: ExecFn,
	worktreePath: string,
	label: string,
	signal?: AbortSignal,
	failed = false,
): Promise<boolean> {
	try {
		const { stdout } = await exec(
			"git",
			["-C", worktreePath, "status", "--porcelain"],
			{ signal },
		);
		if (!stdout.trim()) return false; // nothing to commit

		await exec("git", ["-C", worktreePath, "add", "-A"], { signal });
		const msg = failed
			? `captain: ${label} output [FAILED — recover from this branch]`
			: `captain: ${label} output`;
		await exec("git", ["-C", worktreePath, "commit", "-m", msg], { signal });
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		// biome-ignore lint/suspicious/noConsole: intentional diagnostic output for worktree failures
		console.warn(`[captain] commit failed for "${worktreePath}": ${msg}`);
		return false;
	}
}

async function deleteBranch(
	exec: ExecFn,
	cwd: string,
	branchName: string,
	signal?: AbortSignal,
): Promise<void> {
	try {
		await exec("git", ["-C", cwd, "branch", "-D", branchName], { signal });
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (!(msg.includes("not found") || msg.includes("error: branch"))) {
			// biome-ignore lint/suspicious/noConsole: intentional diagnostic output for worktree failures
			console.warn(
				`[captain] branch delete failed for "${branchName}": ${msg}`,
			);
		}
	}
}

/** Remove a worktree and optionally delete its branch */
export async function removeWorktree(
	exec: ExecFn,
	cwd: string,
	worktreePath: string,
	branchName: string,
	signal?: AbortSignal,
	/** If true, keep the branch in git history (work was committed) */
	keepBranch = false,
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
			// biome-ignore lint/suspicious/noConsole: intentional diagnostic output for worktree failures
			console.warn(
				`[captain] worktree remove failed for "${worktreePath}": ${msg}`,
			);
		}
	}

	// Delete branch unless work was committed — in that case keep it for recovery
	if (!keepBranch) await deleteBranch(exec, cwd, branchName, signal);
}

/** Sequential cleanup with final prune to ensure git state stays clean */
export async function removeWorktreesSequential(
	exec: ExecFn,
	cwd: string,
	worktrees: { path: string; branch: string }[],
	signal?: AbortSignal,
): Promise<void> {
	// Remove worktrees sequentially to avoid git state corruption
	for (const wt of worktrees) {
		await removeWorktree(exec, cwd, wt.path, wt.branch, signal);
	}

	// Final cleanup to remove any stale worktree references
	try {
		await exec("git", ["-C", cwd, "worktree", "prune"], { signal });
	} catch (err) {
		// Prune failure is not critical, just log it
		const msg = err instanceof Error ? err.message : String(err);
		// biome-ignore lint/suspicious/noConsole: intentional diagnostic output for worktree failures
		console.warn(`[captain] git worktree prune failed: ${msg}`);
	}
}
