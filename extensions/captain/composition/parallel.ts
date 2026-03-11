// ── Parallel Pipeline Execution ───────────────────────────────────────────
// Run different steps in parallel branches (git worktrees)

import type { MergeCtx } from "../merge.js";
import type { ExecutorContext } from "../steps/runner.js";
import type { Parallel, Runnable, StepResult } from "../types.js";
import { applyTransform, runContainerGate } from "../utils/execution.js";
import { createWorktree, isGitRepo, removeWorktree } from "../worktree.js";

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
	const worktrees: { path: string; branch: string }[] = [];
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
			};
			return executeRunnable(step, input, original, branchCtx);
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
		await Promise.all(
			worktrees.map((wt) =>
				removeWorktree(ectx.exec, ectx.cwd, wt.path, wt.branch, ectx.signal),
			),
		);
	}
}
