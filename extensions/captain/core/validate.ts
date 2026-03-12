// ── core/validate.ts — Pure pipeline structure validation ─────────────────
// No I/O. Takes a Runnable, returns a ValidationResult.
// Extracted from tools/validate.ts to stay ≤ 200 lines (Basic_knowledge.md).

import type { Runnable } from "../types.js";

export interface ValidationResult {
	readonly valid: boolean;
	readonly errors: readonly string[];
}

function checkGateOnFail(
	node: { gate?: unknown; onFail?: unknown },
	path: string,
	errors: string[],
): void {
	if (node.onFail && !node.gate)
		errors.push(`${path}: 'onFail' specified but no 'gate' defined`);
}

function validateChildren(
	steps: readonly Runnable[],
	path: string,
	errors: string[],
): void {
	for (let i = 0; i < steps.length; i++) {
		errors.push(...validateRunnable(steps[i], `${path}.steps[${i}]`).errors);
	}
}

function validateStep(
	node: Extract<Runnable, { kind: "step" }>,
	path: string,
	errors: string[],
): void {
	if (!node.label) errors.push(`${path}: Step missing required field 'label'`);
	if (!node.prompt)
		errors.push(`${path}: Step missing required field 'prompt'`);
	checkGateOnFail(node, path, errors);
}

function validateSequential(
	node: Extract<Runnable, { kind: "sequential" }>,
	path: string,
	errors: string[],
): void {
	if (!Array.isArray(node.steps)) {
		errors.push(`${path}: Sequential missing required field 'steps' (array)`);
	} else if (node.steps.length === 0) {
		errors.push(`${path}: Sequential 'steps' array cannot be empty`);
	} else {
		validateChildren(node.steps, path, errors);
	}
	checkGateOnFail(node, path, errors);
}

function validatePool(
	node: Extract<Runnable, { kind: "pool" }>,
	path: string,
	errors: string[],
): void {
	if (!node.step) {
		errors.push(`${path}: Pool missing required field 'step'`);
	} else {
		errors.push(...validateRunnable(node.step, `${path}.step`).errors);
	}
	if (typeof node.count !== "number" || node.count <= 0)
		errors.push(`${path}: Pool missing or invalid 'count'`);
	if (!node.merge) errors.push(`${path}: Pool missing required field 'merge'`);
	checkGateOnFail(node, path, errors);
}

function validateParallel(
	node: Extract<Runnable, { kind: "parallel" }>,
	path: string,
	errors: string[],
): void {
	if (!Array.isArray(node.steps)) {
		errors.push(`${path}: Parallel missing required field 'steps' (array)`);
	} else if (node.steps.length === 0) {
		errors.push(`${path}: Parallel 'steps' array cannot be empty`);
	} else {
		validateChildren(node.steps, path, errors);
	}
	if (!node.merge)
		errors.push(`${path}: Parallel missing required field 'merge'`);
	checkGateOnFail(node, path, errors);
}

/** Recursively validate a Runnable pipeline spec. Returns errors list. */
export function validateRunnable(
	runnable: Runnable,
	path = "",
): ValidationResult {
	const errors: string[] = [];
	const fullPath = path || "root";

	if (!runnable.kind) {
		errors.push(`${fullPath}: Missing required field 'kind'`);
		return { valid: false, errors };
	}

	switch (runnable.kind) {
		case "step":
			validateStep(runnable, fullPath, errors);
			break;
		case "sequential":
			validateSequential(runnable, fullPath, errors);
			break;
		case "pool":
			validatePool(runnable, fullPath, errors);
			break;
		case "parallel":
			validateParallel(runnable, fullPath, errors);
			break;
		default:
			errors.push(
				`${fullPath}: Unknown kind '${(runnable as { kind: string }).kind}'`,
			);
	}

	return { valid: errors.length === 0, errors };
}
