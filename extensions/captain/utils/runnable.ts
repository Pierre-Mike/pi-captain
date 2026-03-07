// ── Runnable Tree Utilities ────────────────────────────────────────────────
// Pure functions for traversing, describing, and querying Runnable trees.

import type { Gate, OnFail, Runnable } from "../types.js";

/** Find the first step in a Runnable tree whose label matches (case-insensitive substring) */
export function findStepByLabel(
	r: Runnable,
	label: string,
): Runnable | undefined {
	const lc = label.toLowerCase();
	switch (r.kind) {
		case "step":
			return r.label.toLowerCase().includes(lc) ? r : undefined;
		case "sequential":
			for (const s of r.steps) {
				const found = findStepByLabel(s, label);
				if (found) return found;
			}
			return undefined;
		case "pool":
			return findStepByLabel(r.step, label);
		case "parallel":
			for (const s of r.steps) {
				const found = findStepByLabel(s, label);
				if (found) return found;
			}
			return undefined;
		default:
			return undefined;
	}
}

/** Collect all step labels in a Runnable tree (depth-first) */
export function collectStepLabels(r: Runnable): string[] {
	switch (r.kind) {
		case "step":
			return [r.label];
		case "sequential":
			return r.steps.flatMap(collectStepLabels);
		case "pool":
			return collectStepLabels(r.step);
		case "parallel":
			return r.steps.flatMap(collectStepLabels);
		default:
			return [];
	}
}

/** Status icon for step results */
export function statusIcon(status: string): string {
	switch (status) {
		case "passed":
			return "✓";
		case "failed":
			return "✗";
		case "skipped":
			return "⊘";
		case "running":
			return "⏳";
		default:
			return "○";
	}
}

/** Recursively collect all named agent references from a Runnable tree */
export function collectAgentRefs(r: Runnable): string[] {
	switch (r.kind) {
		case "step":
			return r.agent ? [r.agent] : [];
		case "sequential":
			return r.steps.flatMap(collectAgentRefs);
		case "pool":
			return collectAgentRefs(r.step);
		case "parallel":
			return r.steps.flatMap(collectAgentRefs);
		default:
			return [];
	}
}

/** Format the gate/onFail suffix for container runnables (sequential, pool, parallel) */
export function containerGateInfo(
	gate: Gate | undefined,
	onFail: OnFail | undefined,
): string {
	return gate
		? ` (gate: ${gate.type}, onFail: ${onFail?.action ?? "none"})`
		: "";
}

/** Human-readable description of a Runnable tree */
export function describeRunnable(r: Runnable, indent: number): string {
	const pad = " ".repeat(indent);

	switch (r.kind) {
		case "step": {
			const who = r.agent
				? `agent: ${r.agent}`
				: `model: ${r.model ?? "default"}, tools: ${(r.tools ?? ["read", "bash", "edit", "write"]).join(",")}`;
			const json = r.jsonOutput ? ", json" : "";
			return `${pad}→ [step] "${r.label}" (${who}${json}, gate: ${r.gate.type}, onFail: ${r.onFail.action})`;
		}

		case "sequential":
			return [
				`${pad}⟶ [sequential] (${r.steps.length} steps)${containerGateInfo(r.gate, r.onFail)}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");

		case "pool":
			return [
				`${pad}⟳ [pool] ×${r.count} (merge: ${r.merge.strategy})${containerGateInfo(r.gate, r.onFail)}`,
				describeRunnable(r.step, indent + 2),
			].join("\n");

		case "parallel":
			return [
				`${pad}⫸ [parallel] (${r.steps.length} branches, merge: ${r.merge.strategy})${containerGateInfo(r.gate, r.onFail)}`,
				...r.steps.map((s) => describeRunnable(s, indent + 2)),
			].join("\n");

		default:
			return `${pad}? unknown`;
	}
}
