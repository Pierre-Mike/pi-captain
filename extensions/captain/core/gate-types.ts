// ── Gate, OnFail, Transform, and Merge primitive types ───────────────────

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
	readonly modelRegistry?: import("./utils/model.js").ModelRegistryLike;
	/** Names of tools that were actually called during the step */
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

/** Decision returned by OnFail: retry | fail | skip | warn | fallback(step) */
export type OnFailResult =
	| { readonly action: "retry" }
	| { readonly action: "fail" }
	| { readonly action: "skip" }
	| { readonly action: "warn" }
	| { readonly action: "fallback"; readonly step: import("./types.js").Step };

/** Failure handler — pure function; all retry logic lives inside it. */
export type OnFail = (ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>;

/** Same surface as GateCtx — transforms can exec shell, call LLMs, or use the UI. */
export type TransformCtx = GateCtx;

/** Maps one step's output to the next step's input. */
export type Transform = (params: {
	/** The raw output produced by the step */
	readonly output: string;
	/** The very first input to the whole pipeline ($ORIGINAL) */
	readonly original: string;
	/** Side-effect helpers (shell, confirm, LLM model, …) */
	readonly ctx: TransformCtx;
}) => string | Promise<string>;

/** Combines multiple branch outputs into one string. */
export type MergeFn = (
	outputs: readonly string[],
	ctx: import("./merge.js").MergeCtx,
) => string | Promise<string>;
