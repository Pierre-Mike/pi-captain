// ── Step lifecycle hook types ─────────────────────────────────────────────
import type { StepResult } from "./types.js";

/** Context passed to every step-level hook. */
export interface StepHookCtx {
	/** Step label */
	readonly label: string;
	/** The resolved $INPUT for this step (after variable substitution) */
	readonly input: string;
	/** The very first input to the pipeline ($ORIGINAL) */
	readonly original: string;
}

/** Context passed to tool-call hooks (extends StepHookCtx). */
export interface ToolHookCtx extends StepHookCtx {
	readonly toolName: string;
	readonly toolInput?: unknown;
}

/**
 * Per-step lifecycle hooks.
 * Each hook runs **before** the matching pipeline-level `ExecutorContext` callback.
 * All params are grouped in a single object so order never matters.
 */
export interface StepHooks {
	/** Called just before the step prompt is sent to the agent. */
	onStart?: (ctx: StepHookCtx) => void | Promise<void>;
	/** Called after the step finishes (pass, fail, or skip). */
	onFinish?: (
		ctx: StepHookCtx & { readonly result: StepResult },
	) => void | Promise<void>;
	/** Called just before each tool invocation inside the step. */
	onToolCallStart?: (ctx: ToolHookCtx) => void | Promise<void>;
	/** Called right after each tool invocation completes. */
	onToolCallEnd?: (
		ctx: ToolHookCtx & { readonly output: unknown; readonly isError: boolean },
	) => void | Promise<void>;
}
