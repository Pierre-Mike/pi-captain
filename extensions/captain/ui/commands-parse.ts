// ── ui/commands-parse.ts — Parsing helpers for slash commands ───────────────
// Extracted from commands.ts to stay within 200-line limit (Basic_knowledge.md).

import type { Step } from "../core/types.js";
import { skip } from "../gates/on-fail.js";
import type { CaptainState } from "../state.js";
import { full } from "../transforms/presets.js";

type NotifyFn = (msg: string, level: "info" | "error") => void;

/**
 * Parse `/captain <pipeline> <input>` where each token may be single-quoted,
 * double-quoted, or an unquoted word.  The pipeline token is the first token;
 * everything after it (including any surrounding quotes) is joined as the input.
 *
 * Examples:
 *   '/path/to/pipe.ts' 'hello world'   → { pipeline: "/path/to/pipe.ts", input: "hello world" }
 *   my-preset do something              → { pipeline: "my-preset",         input: "do something" }
 *   'my preset'                         → { pipeline: "my preset",          input: "" }
 */
export function parsePipelineAndInput(raw: string): {
	pipeline: string;
	input: string;
} {
	const tokens: string[] = [];
	const re = /(['"])(.*?)\1|(\S+)/gs;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: idiomatic while loop
	while ((m = re.exec(raw)) !== null) {
		tokens.push(m[2] !== undefined ? m[2] : m[3]);
	}
	if (tokens.length === 0) return { pipeline: "", input: "" };
	const [pipeline, ...rest] = tokens;
	return { pipeline, input: rest.join(" ") };
}

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

/**
 * Ensure a named pipeline is loaded (auto-loads from presets).
 * Returns the resolved pipeline name (may differ from the input when a file
 * path is given — the stored key is always basename without extension).
 * Returns undefined if loading failed.
 */
export async function ensurePipelineLoaded(
	name: string,
	cwd: string,
	state: CaptainState,
	notify: NotifyFn,
): Promise<string | undefined> {
	if (state.pipelines[name]) return name;
	try {
		const resolved = await state.resolvePreset(name, cwd);
		if (!resolved) {
			notify(
				`Pipeline "${name}" not found. Place .ts files in .pi/pipelines/ or pass a valid file path.`,
				"error",
			);
			return undefined;
		}
		notify(`Auto-loaded "${resolved.name}"`, "info");
		return resolved.name;
	} catch (err) {
		notify(
			`Failed to load pipeline "${name}": ${err instanceof Error ? err.message : String(err)}`,
			"error",
		);
		return undefined;
	}
}
