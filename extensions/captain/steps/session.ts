// ── steps/session.ts — Tool resolution & session lifecycle ────────────────
// Pure tool resolution + session creation/warming.
// Extracted from runner.ts to keep file sizes ≤ 200 lines (Basic_knowledge.md).

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	createAgentSession,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	getAgentDir,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import type { Step } from "../types.js";
import { resolveModel } from "../utils/model.js";
import type { ExecutorContext } from "./runner.js";

// biome-ignore lint/suspicious/noExplicitAny: tool schemas vary per tool
type AnyAgentTool = AgentTool<any>;

export type AgentSession = Awaited<
	ReturnType<typeof createAgentSession>
>["session"];

/**
 * A warm session: model loaded, tools wired, resource loader injected,
 * but `.prompt()` not yet called — ready for the next step's input.
 */
export type WarmSession = {
	readonly session: AgentSession;
	readonly resolvedModel: Model<Api>;
};

/** Map tool name strings to SDK Tool instances for a given cwd. */
export function resolveTools(
	names: readonly string[],
	cwd: string,
): AnyAgentTool[] {
	return names.flatMap((name): AnyAgentTool[] => {
		switch (name) {
			case "read":
				return [createReadTool(cwd)];
			case "bash":
				return [createBashTool(cwd)];
			case "edit":
				return [createEditTool(cwd)];
			case "write":
				return [createWriteTool(cwd)];
			case "grep":
				return [createGrepTool(cwd)];
			case "find":
				return [createFindTool(cwd)];
			case "ls":
				return [createLsTool(cwd)];
			default:
				return [];
		}
	});
}

/**
 * Build (or reuse from cache) a DefaultResourceLoader for the given config.
 * Steps with identical configs share one loader to avoid redundant disk scans.
 */
export async function getOrCreateLoader(
	ectx: ExecutorContext,
	systemPrompt: string | undefined,
	extensions: readonly string[] | undefined,
	skills: readonly string[] | undefined,
): Promise<DefaultResourceLoader> {
	const agentDir = getAgentDir();
	const key = JSON.stringify({
		cwd: ectx.cwd,
		agentDir,
		systemPrompt,
		extensions: extensions ?? [],
		skills: skills ?? [],
	});

	if (ectx.loaderCache?.has(key)) {
		return ectx.loaderCache.get(key) as DefaultResourceLoader;
	}

	const loader = new DefaultResourceLoader({
		cwd: ectx.cwd,
		agentDir,
		...(systemPrompt && { systemPrompt }),
		...((extensions?.length ?? 0) > 0 && {
			additionalExtensionPaths: [...(extensions ?? [])],
		}),
		...((skills?.length ?? 0) > 0 && {
			additionalSkillPaths: [...(skills ?? [])],
		}),
	});
	await loader.reload();
	ectx.loaderCache?.set(key, loader);
	return loader;
}

/** Create a new agent session for the given step + context. */
export async function createStepSession(
	step: Step,
	ectx: ExecutorContext,
	resolvedModel: Model<Api>,
): Promise<AgentSession> {
	const toolNames = step.tools ?? ["read", "bash", "edit", "write"];
	const tools = resolveTools(toolNames, ectx.cwd);
	const loader = await getOrCreateLoader(
		ectx,
		step.systemPrompt,
		step.extensions,
		step.skills,
	);
	const { session } = await createAgentSession({
		cwd: ectx.cwd,
		model: resolvedModel,
		tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
		}),
		...(step.temperature !== undefined && { temperature: step.temperature }),
	});
	return session;
}

/**
 * Start creating an agent session for `step` in the background.
 * Purely opportunistic — never throws; errors fall back to the cold-start path.
 */
export function prefetchSession(
	step: Step,
	ectx: ExecutorContext,
): Promise<WarmSession | null> {
	return (async (): Promise<WarmSession | null> => {
		if (ectx.signal?.aborted) return null;
		try {
			const resolvedModel = step.model
				? resolveModel(step.model, ectx.modelRegistry, ectx.model)
				: ectx.model;
			const session = await createStepSession(step, ectx, resolvedModel);
			return { session, resolvedModel };
		} catch {
			// Best-effort — never crash the pipeline on prefetch failure.
			return null;
		}
	})();
}
