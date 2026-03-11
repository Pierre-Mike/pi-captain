import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { Runnable } from "../types.js";

interface ValidationResult {
	valid: boolean;
	errors: string[];
}

function checkGateOnFailConsistency(
	runnable: { gate?: unknown; onFail?: unknown },
	fullPath: string,
	errors: string[],
): void {
	if (runnable.onFail && !runnable.gate) {
		errors.push(`${fullPath}: 'onFail' specified but no 'gate' defined`);
	}
}

function validateChildren(
	steps: Runnable[],
	fullPath: string,
	errors: string[],
): void {
	for (let i = 0; i < steps.length; i++) {
		const child = validateRunnable(steps[i], `${fullPath}.steps[${i}]`);
		errors.push(...child.errors);
	}
}

function validateStep(
	runnable: Extract<Runnable, { kind: "step" }>,
	fullPath: string,
	errors: string[],
): void {
	if (!runnable.label)
		errors.push(`${fullPath}: Step missing required field 'label'`);
	if (!runnable.prompt)
		errors.push(`${fullPath}: Step missing required field 'prompt'`);
	checkGateOnFailConsistency(runnable, fullPath, errors);
}

function validateSequential(
	runnable: Extract<Runnable, { kind: "sequential" }>,
	fullPath: string,
	errors: string[],
): void {
	if (!Array.isArray(runnable.steps)) {
		errors.push(
			`${fullPath}: Sequential missing required field 'steps' (array)`,
		);
	} else if (runnable.steps.length === 0) {
		errors.push(`${fullPath}: Sequential 'steps' array cannot be empty`);
	} else {
		validateChildren(runnable.steps, fullPath, errors);
	}
	checkGateOnFailConsistency(runnable, fullPath, errors);
}

function validatePool(
	runnable: Extract<Runnable, { kind: "pool" }>,
	fullPath: string,
	errors: string[],
): void {
	if (!runnable.step) {
		errors.push(`${fullPath}: Pool missing required field 'step'`);
	} else {
		errors.push(...validateRunnable(runnable.step, `${fullPath}.step`).errors);
	}
	if (typeof runnable.count !== "number" || runnable.count <= 0) {
		errors.push(
			`${fullPath}: Pool missing or invalid 'count' (must be positive number)`,
		);
	}
	if (!runnable.merge)
		errors.push(`${fullPath}: Pool missing required field 'merge'`);
	checkGateOnFailConsistency(runnable, fullPath, errors);
}

function validateParallel(
	runnable: Extract<Runnable, { kind: "parallel" }>,
	fullPath: string,
	errors: string[],
): void {
	if (!Array.isArray(runnable.steps)) {
		errors.push(`${fullPath}: Parallel missing required field 'steps' (array)`);
	} else if (runnable.steps.length === 0) {
		errors.push(`${fullPath}: Parallel 'steps' array cannot be empty`);
	} else {
		validateChildren(runnable.steps, fullPath, errors);
	}
	if (!runnable.merge)
		errors.push(`${fullPath}: Parallel missing required field 'merge'`);
	checkGateOnFailConsistency(runnable, fullPath, errors);
}

function validateRunnable(runnable: Runnable, path = ""): ValidationResult {
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

export function registerValidateTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_validate",
		label: "Captain Validate",
		description: [
			"Validate a pipeline specification for structural correctness.",
			"Checks required fields, gate/onFail consistency, and merge presence for parallel/pool.",
			"Accepts either a pipeline name (already loaded) or a raw JSON spec string.",
		].join("\n"),
		parameters: Type.Union([
			Type.Object({
				name: Type.String({
					description: "Name of an already-loaded pipeline to validate",
				}),
			}),
			Type.Object({
				spec: Type.String({
					description: "Raw JSON string of the Runnable tree to validate",
				}),
			}),
		]),

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			let runnable: Runnable;
			let sourceName: string;

			try {
				if ("name" in params) {
					// Validate an already-loaded pipeline by name
					const pipeline = state.pipelines[params.name];
					if (!pipeline) {
						return {
							content: [
								{
									type: "text",
									text: `✗ Pipeline "${params.name}" not found. Use captain_list to see available pipelines.`,
								},
							],
							details: undefined,
						};
					}
					runnable = pipeline.spec;
					sourceName = params.name;
				} else {
					// Validate a raw JSON spec string
					runnable = JSON.parse(params.spec) as Runnable;
					sourceName = "spec";
				}
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: `✗ Error parsing pipeline spec: ${err instanceof Error ? err.message : String(err)}`,
						},
					],
					details: undefined,
				};
			}

			// Perform validation
			const result = validateRunnable(runnable);

			if (result.valid) {
				return {
					content: [
						{
							type: "text",
							text: `✓ Pipeline "${sourceName}" is structurally valid.`,
						},
					],
					details: undefined,
				};
			} else {
				const errorList = result.errors
					.map((error) => `  • ${error}`)
					.join("\n");
				return {
					content: [
						{
							type: "text",
							text: `✗ Pipeline "${sourceName}" has validation errors:\n\n${errorList}`,
						},
					],
					details: undefined,
				};
			}
		},

		renderCall: (args, theme) => {
			const target = "name" in args ? `name=${args.name}` : "spec";
			return new Text(
				theme.fg("toolTitle", theme.bold("captain_validate ")) +
					theme.fg("accent", target),
				0,
				0,
			);
		},
		renderResult: (result, _opts, theme) => {
			if (
				result.content[0] &&
				"text" in result.content[0] &&
				result.content[0].text.startsWith("✓")
			)
				return new Text(theme.fg("success", "✓ Valid"), 0, 0);
			return new Text(theme.fg("error", "✗ Invalid"), 0, 0);
		},
	});
}
