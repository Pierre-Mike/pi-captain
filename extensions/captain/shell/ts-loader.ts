// ── shell/ts-loader.ts — Dynamic TypeScript pipeline loader ───────────────
// Extracted from state.ts to stay within 200-line limit (Basic_knowledge.md).
// Impureim Sandwich: read raw → compute alias replacement → write temp → import → cleanup.

import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { FsPort } from "../ports.js";
import type { Runnable } from "../types.js";

const ALIAS_BRACKETS = `"<captain>/`;
const ALIAS_NO_BRACKETS = `"captain/`;

/** Replace captain alias imports in source with the absolute captainDir path. */
function resolveAliases(raw: string, captainDir: string): string {
	return raw
		.replaceAll(ALIAS_BRACKETS, `"${captainDir}/`)
		.replaceAll(ALIAS_NO_BRACKETS, `"${captainDir}/`);
}

/** Extract the `pipeline` export from a dynamically imported module. */
function extractPipeline(mod: Record<string, unknown>): Runnable | undefined {
	const direct = (mod as Record<string, { pipeline?: Runnable } & Runnable>)
		.pipeline;
	if (direct && typeof direct === "object" && "kind" in direct)
		return direct as unknown as Runnable;
	const fromDefault = (mod.default as { pipeline?: Runnable } | undefined)
		?.pipeline;
	return fromDefault;
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
			`Invalid TypeScript pipeline file: "${filePath}" must export a "pipeline" const of type Runnable.\n` +
				`Tip: ensure your file exports a "pipeline" const with a "kind" field.\n` +
				`If you used captain aliases, use "<captain>/" or "captain/" (e.g. "captain/gates/on-fail.js")`,
		);
	}

	const ext = filePath.endsWith(".ts") ? ".ts" : ".js";
	const name = basename(filePath, ext);
	pipelines[name] = { spec: pipeline };
	return { name, spec: pipeline, source: filePath };
}
