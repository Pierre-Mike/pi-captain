// ── shell/ts-loader.ts — Dynamic TypeScript pipeline loader ───────────────
// Extracted from state.ts to stay within 200-line limit (Basic_knowledge.md).
// Impureim Sandwich: read raw → compute alias replacement → write temp → import → cleanup.

import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { FsPort } from "../core/ports.js";
import type { Runnable } from "../core/types.js";

const ALIAS_BRACKETS = `"<captain>/`;
const ALIAS_NO_BRACKETS = `"captain/`;

/** Replace captain alias imports in source with the absolute captainDir path. */
export function resolveAliases(raw: string, captainDir: string): string {
	return raw
		.replaceAll(ALIAS_BRACKETS, `"${captainDir}/`)
		.replaceAll(ALIAS_NO_BRACKETS, `"${captainDir}/`);
}

const RUNNABLE_KINDS = new Set(["step", "sequential", "pool", "parallel"]);

/** Extract the `pipeline` export from a dynamically imported module.
 * Falls back to scanning all exports for any object with a valid `kind`
 * so that step files (e.g. `export const reviewCode: Step = { ... }`)
 * can be loaded directly without wrapping them in a pipeline file.
 */
export function extractPipeline(
	mod: Record<string, unknown>,
): Runnable | undefined {
	const direct = (mod as Record<string, { pipeline?: Runnable } & Runnable>)
		.pipeline;
	if (direct && typeof direct === "object" && "kind" in direct)
		return direct as unknown as Runnable;
	const fromDefault = (mod.default as { pipeline?: Runnable } | undefined)
		?.pipeline;
	if (fromDefault) return fromDefault;

	// Fall back: scan every named export for a Runnable shape
	for (const [key, val] of Object.entries(mod)) {
		if (key === "default") continue;
		if (
			val &&
			typeof val === "object" &&
			"kind" in val &&
			RUNNABLE_KINDS.has((val as { kind: string }).kind)
		) {
			return val as unknown as Runnable;
		}
	}
	return undefined;
}

/**
 * Load a TypeScript pipeline file, resolving captain aliases if needed.
 * Registers the result into the provided pipelines registry.
 */
export async function loadTsPipelineFile(
	filePath: string,
	captainDir: string,
	pipelines: Record<string, { spec: Runnable }>,
	fs: FsPort,
): Promise<{ name: string; spec: Runnable; source: string }> {
	const raw = fs.readText(filePath);
	const needsAlias =
		raw.includes(ALIAS_BRACKETS) || raw.includes(ALIAS_NO_BRACKETS);

	let importPath = filePath;
	if (needsAlias) {
		const resolved = resolveAliases(raw, captainDir);
		const tmpFile = join(tmpdir(), `captain-pipeline-${Date.now()}.ts`);
		fs.writeText(tmpFile, resolved);
		importPath = tmpFile;
	}

	let mod: Record<string, unknown>;
	try {
		mod = await import(importPath);
	} finally {
		if (needsAlias) {
			try {
				fs.remove(importPath);
			} catch {
				/* best-effort cleanup */
			}
		}
	}

	const pipeline = extractPipeline(mod);
	if (!pipeline?.kind) {
		throw new Error(
			`Invalid TypeScript pipeline file: "${filePath}" must export a Runnable.\n` +
				`Tip: export a "pipeline" const, OR any named const with kind "step" | "sequential" | "pool" | "parallel".\n` +
				`If you used captain aliases, use "<captain>/" or "captain/" (e.g. "captain/gates/on-fail.js")`,
		);
	}

	const ext = filePath.endsWith(".ts") ? ".ts" : ".js";
	const name = basename(filePath, ext);
	pipelines[name] = { spec: pipeline };
	return { name, spec: pipeline, source: filePath };
}
