// ── ui/commands-parse.ts — Parsing helpers for slash commands ───────────────
// Extracted from commands.ts to stay within 200-line limit (Basic_knowledge.md).
import { collectStepLabels, findStepByLabel } from "../core/utils/index.js";
import { skip } from "../gates/on-fail.js";
import type { CaptainState } from "../state.js";
import { full } from "../transforms/presets.js";
import type { Runnable, Step } from "../types.js";

type NotifyFn = (msg: string, level: "info" | "error") => void;

/** Parse --step flag out of raw args string; return { stepFilter, cleanedArgs } */
export function parseStepFlag(raw: string): {
	stepFilter: string | undefined;
	cleanedArgs: string;
} {
	const stepMatch = raw.match(/--step\s+["']?([^"']+?)["']?(?:\s|$)/);
	const cleanedArgs = raw
		.replace(/--step\s+["']?[^"']+?["']?(?:\s|$)/, "")
		.trim();
	return { stepFilter: stepMatch?.[1].trim(), cleanedArgs };
}

/** Parse --key value flags from a string; return flags map and remaining prompt */
export function parseInlineFlags(input: string): {
	flags: Record<string, string>;
	prompt: string;
} {
	const flags: Record<string, string> = {};
	const flagRe = /--(\w+)\s+([^-][^\s]*(?:\s+[^-][^\s]*)*?)(?=\s+--|$)/g;
	let m: RegExpExecArray | null;
	const toRemove: string[] = [];
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic while loop
	while ((m = flagRe.exec(input)) !== null) {
		flags[m[1]] = m[2].trim();
		toRemove.push(m[0]);
	}
	let rest = input;
	for (const rm of toRemove) rest = rest.replace(rm, "");
	return { flags, prompt: rest.trim() };
}

/** Build a Step spec from parsed /captain-step flags */
export function buildAdHocStep(
	prompt: string,
	flags: Record<string, string>,
): Step {
	const label = flags.label ?? "ad-hoc step";
	const modelId = flags.model;
	const toolsList = flags.tools?.split(",").map((t) => t.trim());
	return {
		kind: "step",
		label,
		prompt,
		model: modelId,
		tools: toolsList ?? ["read", "bash", "edit", "write"],
		gate: undefined,
		onFail: skip,
		transform: full,
	};
}

/** Ensure a named pipeline is loaded (auto-loads from presets). Returns false if the caller should abort. */
export async function ensurePipelineLoaded(
	name: string,
	cwd: string,
	state: CaptainState,
	notify: NotifyFn,
): Promise<boolean> {
	if (state.pipelines[name]) return true;
	try {
		const resolved = await state.resolvePreset(name, cwd);
		if (!resolved) {
			notify(
				`Pipeline "${name}" not found. Use /captain-load to see available presets.`,
				"error",
			);
			return false;
		}
		notify(`Auto-loaded preset "${name}"`, "info");
		return true;
	} catch (err) {
		notify(
			`Failed to load pipeline "${name}": ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return false;
	}
}

/** Parse and validate args for /captain-run; returns null if the handler should abort */
export async function parseCaptainRunArgs(
	args: string,
	state: CaptainState,
	cwd: string,
	notify: NotifyFn,
): Promise<{
	name: string;
	input: string;
	stepFilter: string | undefined;
	specToRun: Runnable;
} | null> {
	const raw = args?.trim() ?? "";
	const { stepFilter, cleanedArgs } = parseStepFlag(raw);
	const parts = cleanedArgs.split(/\s+/);
	const name = parts[0];
	const input = parts.slice(1).join(" ");

	if (!name) {
		const loadedNames = Object.keys(state.pipelines);
		if (loadedNames.length === 0) {
			notify(
				"Usage: /captain-run <name> [--step <label>] <input>\nNo pipelines loaded. Use /captain-load first.",
				"error",
			);
		} else {
			notify(
				`Usage: /captain-run <name> [--step <label>] <input>\n\nLoaded pipelines:\n${loadedNames.map((n: string) => `  • ${n}`).join("\n")}`,
				"info",
			);
		}
		return null;
	}
	if (!input) {
		notify(
			`Usage: /captain-run ${name} [--step <label>] <input>\nProvide an input string after the pipeline name.`,
			"error",
		);
		return null;
	}
	if (!(await ensurePipelineLoaded(name, cwd, state, notify))) return null;

	let specToRun: Runnable | undefined = state.pipelines[name].spec;
	if (stepFilter) {
		specToRun = findStepByLabel(specToRun, stepFilter);
		if (!specToRun) {
			const labels = collectStepLabels(state.pipelines[name].spec);
			notify(
				`Step "${stepFilter}" not found in pipeline "${name}".\n\nAvailable steps:\n${labels.map((l) => `  • ${l}`).join("\n")}`,
				"error",
			);
			return null;
		}
	}

	return { name, input, stepFilter, specToRun };
}
