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
): Promise<{ worktreePath: string; branchName: string } | null> {
	if (!(await isGitRepo(exec, cwd))) return null;

	const sanitized = `${pipelineName}-${branchLabel}-${index}`.replace(
		/[^a-zA-Z0-9_-]/g,
		"_",
	);
	const worktreePath = path.join(cwd, ".worktrees", sanitized);
	const branchName = `captain/${sanitized}`;

	try {
		// Clean up any stale worktree/branch from a previous crashed run
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
	} catch {
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
	} catch {
		// Worktree may already be gone
	}
	try {
		await exec("git", ["-C", cwd, "branch", "-D", branchName], { signal });
	} catch {
		// Branch may already be gone
	}
}
