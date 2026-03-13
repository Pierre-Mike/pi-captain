// ── Pool Pipeline Execution ───────────────────────────────────────────────
// Run the same step N times in parallel branches (git worktrees)

import type { MergeCtx } from "../core/merge.js";
import type { Pool, Runnable, StepResult } from "../core/types.js";
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
): Promise<void> {
	const committed = await commitWorktreeChanges(
		exec,
		wt.worktreePath,
		label,
		signal,
	);
	if (committed) {
		const entry = worktrees.find((w) => w.path === wt.worktreePath);
		if (entry) entry.keep = true;
	}
}

/**
 * Execute a pool pipeline with git worktree isolation.
 * Runs the same step N times in parallel, each in its own git worktree.
 */
export async function executePool(
	pool: Pool,
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

		const poolGroup = `pool ×${pool.count}: ${getLabel(pool.step) || "step"}`;
		const promises = Array.from({ length: pool.count }, async (_, i) => {
			const label = getLabel(pool.step) || `pool-${i}`;
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
				stepGroup: poolGroup,
				sharedSession: undefined, // each branch needs its own session
			};
			// Tag each pool instance with its index so they get unique labels in
			// currentSteps/results — without this all N instances share one label
			// and the Set collapses them into a single entry.
			const taggedStep =
				pool.count > 1 && pool.step.kind === "step"
					? { ...pool.step, label: `${pool.step.label} [${i + 1}]` }
					: pool.step;
			const result = await executeRunnable(
				taggedStep,
				`${input}\n[Branch ${i + 1} of ${pool.count}]`,
				original,
				branchCtx,
			);
			// Commit any file changes produced by this worker (only on success —
			// if executeRunnable threw, we never reach this line).
			if (wt)
				await saveWorktreeOutput(ectx.exec, wt, label, worktrees, ectx.signal);
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
		const merged = await pool.merge(outputs, mctx);
		const checked = await runContainerGate(
			merged,
			allResults,
			pool.gate,
			pool.onFail,
			`pool ×${pool.count}`,
			() => executePool(pool, input, original, ectx, executeRunnable),
			ectx,
			0,
		);
		if (pool.transform) {
			checked.output = await applyTransform(
				pool.transform,
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
