// ── Parallel Pipeline Execution ───────────────────────────────────────────
// Run different steps in parallel branches (git worktrees)

import type { MergeCtx } from "../core/merge.js";
import type { Parallel, Runnable, StepResult } from "../core/types.js";
import {
	commitWorktreeChanges,
	createWorktree,
	isGitRepo,
	removeWorktree,
} from "../infra/worktree.js";
import type { ExecutorContext } from "../steps/runner.js";
import { applyTransform, runContainerGate } from "./execution.js";

function getLabel(r: Runnable): string {
	switch (r.kind) {
		case "step":
			return r.label;
		case "sequential":
			return `seq-${r.steps[0] ? getLabel(r.steps[0]) : "empty"}`;
		case "pool":
			return `pool-${getLabel(r.step)}`;
		case "parallel":
			return "par";
		default:
			return "unknown";
	}
}

type WorktreeEntry = { path: string; branch: string; keep?: boolean };

/** Commit worker output and mark the branch for preservation if files changed. */
async function saveWorktreeOutput(
	exec: Parameters<typeof commitWorktreeChanges>[0],
	wt: { worktreePath: string; branchName: string },
	label: string,
	worktrees: WorktreeEntry[],
	signal?: AbortSignal,
	failed = false,
): Promise<void> {
	const committed = await commitWorktreeChanges(
		exec,
		wt.worktreePath,
		label,
		signal,
		failed,
	);
	if (committed) {
		const entry = worktrees.find((w) => w.path === wt.worktreePath);
		if (entry) entry.keep = true;
	}
}

/**
 * Execute a parallel pipeline with git worktree isolation.
 * Runs different steps in parallel, each in its own git worktree.
 */
export async function executeParallel(
	par: Parallel,
	input: string,
	original: string,
	ectx: ExecutorContext,
	executeRunnable: (
		runnable: Runnable,
		input: string,
		original: string,
		ectx: ExecutorContext,
	) => Promise<{ output: string; results: StepResult[] }>,
): Promise<{ output: string; results: StepResult[] }> {
	const worktrees: WorktreeEntry[] = [];
	const allResults: StepResult[] = [];

	try {
		// Resolve git-repo status once for this cwd, reuse for all branches.
		const gitRepo = ectx.isGitRepo ?? (await isGitRepo(ectx.exec, ectx.cwd));

		const parGroup = `parallel ×${par.steps.length}`;
		const promises = par.steps.map(async (step, i) => {
			const label = getLabel(step) || `parallel-${i}`;
			const wt = await createWorktree(
				ectx.exec,
				ectx.cwd,
				ectx.pipelineName,
				label,
				i,
				ectx.signal,
				gitRepo,
			);
			if (wt) worktrees.push({ path: wt.worktreePath, branch: wt.branchName });
			const branchCtx: ExecutorContext = {
				...ectx,
				cwd: wt?.worktreePath ?? ectx.cwd,
				stepGroup: parGroup,
				sharedSession: undefined, // each branch needs its own session
			};
			let failed = false;
			let result: Awaited<ReturnType<typeof executeRunnable>>;
			try {
				result = await executeRunnable(step, input, original, branchCtx);
				// Mark as failed if any step result has failed status
				failed = result.results.some((r) => r.status === "failed");
			} catch (err) {
				failed = true;
				// Re-commit partial work before re-throwing so files are recoverable
				if (wt)
					await saveWorktreeOutput(
						ectx.exec,
						wt,
						label,
						worktrees,
						undefined,
						true,
					);
				throw err;
			}
			// Commit on both success and failure — failed branches keep their files
			if (wt)
				await saveWorktreeOutput(
					ectx.exec,
					wt,
					label,
					worktrees,
					ectx.signal,
					failed,
				);
			return result;
		});

		const settled = await Promise.allSettled(promises);
		const outputs: string[] = [];
		for (const r of settled) {
			if (r.status === "fulfilled") {
				outputs.push(r.value.output);
				allResults.push(...r.value.results);
			} else outputs.push(`(error: ${r.reason})`);
		}

		const mctx: MergeCtx = {
			model: ectx.model,
			apiKey: ectx.apiKey,
			signal: ectx.signal,
		};
		const merged = await par.merge(outputs, mctx);
		const checked = await runContainerGate(
			merged,
			allResults,
			par.gate,
			par.onFail,
			`parallel (${par.steps.length} branches)`,
			() => executeParallel(par, input, original, ectx, executeRunnable),
			ectx,
			0,
		);
		if (par.transform) {
			checked.output = await applyTransform(
				par.transform,
				checked.output,
				ectx,
				original,
			);
		}
		return checked;
	} finally {
		// Remove all worktrees in parallel instead of sequentially.
		// Branches that have a commit are kept in git history for recovery.
		// Use `undefined` (no signal) so cleanup always runs — even when the
		// pipeline was killed and ectx.signal is already aborted.
		await Promise.all(
			worktrees.map((wt) =>
				removeWorktree(
					ectx.exec,
					ectx.cwd,
					wt.path,
					wt.branch,
					undefined,
					wt.keep === true,
				),
			),
		);
	}
}
