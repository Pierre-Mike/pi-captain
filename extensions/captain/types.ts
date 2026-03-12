// ── Captain: Pipeline Orchestration Types ──────────────────────────────────

// Re-use the concrete model type from the pi-ai peer dep — it is already
// declared as a peer dependency so importing it here is safe.
export type { ModelRegistryLike } from "./core/utils/model.js";

/**
 * Side-effect helpers available to gates that need shell, UI, or LLM access.
 * Simple gates that only inspect output can ignore this entirely.
 */
export interface GateCtx {
	/** Working directory for shell commands */
	readonly cwd: string;
	readonly signal?: AbortSignal;
	/** Run a shell command — resolves with exit code + stdout/stderr */
	readonly exec: (
		cmd: string,
		args: readonly string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{
		readonly stdout: string;
		readonly stderr: string;
		readonly code: number;
	}>;
	/** Show a confirm dialog (only available in interactive sessions) */
	readonly confirm?: (title: string, body: string) => Promise<boolean>;
	readonly hasUI: boolean;
	/** Current LLM model (used by llm/llmFast/llmStrict gates) */
	readonly model?: import("@mariozechner/pi-ai").Model<
		import("@mariozechner/pi-ai").Api
	>;
	readonly apiKey?: string;
	readonly modelRegistry?: import("./core/utils/model.js").ModelRegistryLike;
	/** Names of tools that were actually called during the step (e.g. ["bash", "web_search"]) */
	readonly toolsUsed?: readonly string[];
}

/**
 * A gate is a plain function: receives the step output and optional side-effect
 * context. Returns true to pass, or a string describing why it failed.
 * Async gates are allowed. Throwing is also treated as a failure.
 */
export type Gate = (params: {
	readonly output: string;
	readonly ctx?: GateCtx;
}) => true | string | Promise<true | string>;

/**
 * Context passed to an OnFail handler — describes why and how many times we've failed.
 */
export interface OnFailCtx {
	/** The gate failure reason */
	readonly reason: string;
	/** How many retries have already been attempted (0 on first failure) */
	readonly retryCount: number;
	/** Total number of times the step has run so far (retryCount + 1) */
	readonly stepCount: number;
	/** The last output produced before the failure */
	readonly output: string;
}

/**
 * The decision an OnFail handler returns — what to do after a gate fails.
 *
 * - `retry`    — re-run the step/scope (any delay is the function's responsibility)
 * - `fail`     — abort the step and mark it as failed
 * - `skip`     — mark as skipped and continue with empty output
 * - `warn`     — log a warning but treat as passed and continue
 * - `fallback` — run an alternative Step instead
 */
export type OnFailResult =
	| { readonly action: "retry" }
	| { readonly action: "fail" }
	| { readonly action: "skip" }
	| { readonly action: "warn" }
	| { readonly action: "fallback"; readonly step: Step };

/**
 * Failure handling strategy — a pure function that receives failure context
 * and returns what to do next. All behaviour (retry limits, delays) lives
 * inside the function; the executor only acts on the returned decision.
 */
export type OnFail = (ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>;

/**
 * Context passed to a Transform function — same surface as GateCtx so
 * transforms can exec shell commands, call LLMs, or interact with the UI.
 */
export type TransformCtx = GateCtx;

/**
 * A transform is a plain function that maps one step's output to the next step's input.
 */
export type Transform = (params: {
	/** The raw output produced by the step */
	readonly output: string;
	/** The very first input to the whole pipeline ($ORIGINAL) */
	readonly original: string;
	/** Side-effect helpers (shell, confirm, LLM model, …) */
	readonly ctx: TransformCtx;
}) => string | Promise<string>;

/**
 * A merge function combines multiple branch outputs into one.
 */
export type MergeFn = (
	outputs: readonly string[],
	ctx: import("./merge.js").MergeCtx,
) => string | Promise<string>;

// ── Composition Types (infinitely nestable) ────────────────────────────────

/**
 * Model identifier — known shorthands or any full model ID.
 */
export type ModelId = "sonnet" | "flash" | "haiku" | "opus" | (string & {});

/** Atomic unit — a single `pi --print` invocation */
export interface Step {
	readonly kind: "step";
	readonly label: string;

	readonly model?: ModelId;
	readonly tools?: readonly string[];
	readonly temperature?: number;
	readonly systemPrompt?: string;
	readonly skills?: readonly string[];
	readonly extensions?: readonly string[];
	readonly jsonOutput?: boolean;
	readonly description?: string;
	readonly prompt: string;

	readonly gate?: Gate;
	readonly onFail?: OnFail;
	readonly transform?: Transform;
}

/** Sequential — run in order, output chains via $INPUT */
export interface Sequential {
	readonly kind: "sequential";
	readonly steps: readonly Runnable[];
	readonly gate?: Gate;
	readonly onFail?: OnFail;
	readonly transform?: Transform;
}

/** Pool — replicate ONE runnable N times */
export interface Pool {
	readonly kind: "pool";
	readonly step: Runnable;
	readonly count: number;
	readonly merge: MergeFn;
	readonly gate?: Gate;
	readonly onFail?: OnFail;
	readonly transform?: Transform;
}

/** Parallel — run DIFFERENT runnables concurrently */
export interface Parallel {
	readonly kind: "parallel";
	readonly steps: readonly Runnable[];
	readonly merge: MergeFn;
	readonly gate?: Gate;
	readonly onFail?: OnFail;
	readonly transform?: Transform;
}

/** Union type — any composable unit */
export type Runnable = Step | Sequential | Pool | Parallel;

// ── Runtime State ──────────────────────────────────────────────────────────
// Mutable execution state lives in runtime-state.ts (kept separate to stay
// within the 200-line limit per file).
export type { PipelineState, StepResult, StepStatus } from "./runtime-state.js";
