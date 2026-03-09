// ── Captain: Pipeline Orchestration Types ──────────────────────────────────

/**
 * Side-effect helpers available to gates that need shell, UI, or LLM access.
 * Simple gates that only inspect output can ignore this entirely.
 */
export interface GateCtx {
	/** Working directory for shell commands */
	cwd: string;
	signal?: AbortSignal;
	/** Run a shell command — resolves with exit code + stdout/stderr */
	exec: (
		cmd: string,
		args: string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
	/** Show a confirm dialog (only available in interactive sessions) */
	confirm?: (title: string, body: string) => Promise<boolean>;
	hasUI: boolean;
	/** Current LLM model (used by llm/llmFast/llmStrict gates) */
	// biome-ignore lint/suspicious/noExplicitAny: model type varies by provider
	model?: any;
	apiKey?: string;
	// biome-ignore lint/suspicious/noExplicitAny: registry type lives in executor
	modelRegistry?: any;
}

/**
 * A gate is a plain function: receives the step output and optional side-effect
 * context. Returns true to pass, or a string describing why it failed.
 * Async gates are allowed. Throwing is also treated as a failure.
 */
export type Gate = (params: {
	output: string;
	ctx?: GateCtx;
}) => true | string | Promise<true | string>;

/**
 * Context passed to an OnFail handler — describes why and how many times we've failed.
 */
export interface OnFailCtx {
	/** The gate failure reason */
	reason: string;
	/** How many retries have already been attempted (0 on first failure) */
	retryCount: number;
	/** Total number of times the step has run so far (retryCount + 1) */
	stepCount: number;
	/** The last output produced before the failure */
	output: string;
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
	| { action: "retry" }
	| { action: "fail" }
	| { action: "skip" }
	| { action: "warn" }
	| { action: "fallback"; step: Step };

/**
 * Failure handling strategy — a pure function that receives failure context
 * and returns what to do next. All behaviour (retry limits, delays) lives
 * inside the function; the executor only acts on the returned decision.
 *
 * @example
 * // Built-in presets
 * onFail: retry()                                         // up to 3 times, then fail
 * onFail: retry(2)                                        // up to 2 times, then fail
 * onFail: retryWithDelay(3, 2000)                         // delay is awaited inside the fn
 * onFail: fallback(myStep)
 * onFail: skip
 * onFail: warn
 *
 * // Custom inline — full control via ctx
 * onFail: ({ retryCount }) => retryCount < 2 ? { action: "retry" } : { action: "warn" }
 */
export type OnFail = (ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>;

/** Data transform between steps */
export type Transform =
	| { kind: "full" } // pass entire output
	| { kind: "extract"; key: string } // extract JSON key from output
	| { kind: "summarize" }; // ask LLM to summarize output

/** Merge strategy for combining parallel/pool outputs */
export type MergeStrategy =
	| "vote"
	| "rank"
	| "firstPass"
	| "concat"
	| "awaitAll";

// ── Composition Types (infinitely nestable) ────────────────────────────────

/** Atomic unit — a single `pi --print` invocation */
export interface Step {
	kind: "step";
	label: string;

	// ── Step config ───────────────────────────────────────────────────────
	/** Model identifier (e.g. "sonnet", "flash"). Passed as --model. */
	model?: string;
	/** Tool names to enable. Passed as --tools read,bash,edit. */
	tools?: string[];
	/** Temperature for the LLM call. */
	temperature?: number;
	/** System prompt text. Passed as --system-prompt. */
	systemPrompt?: string;
	/** Skill file paths. Each passed as --skill <path>. */
	skills?: string[];
	/** Extension file paths. Each passed as --extension <path>. */
	extensions?: string[];
	/** If true, pass --mode json to get structured JSON output. */
	jsonOutput?: boolean;

	description?: string;
	prompt: string; // supports $INPUT, $ORIGINAL interpolation

	// Note: to limit step execution, configure model-level or pipeline-level controls.
	// maxTurns / maxTokens were removed — they were declared but never enforced,
	// which was misleading to users. Add back when the SDK supports them natively.

	gate?: Gate;
	onFail?: OnFail;
	transform: Transform;
}

/** Sequential — run in order, output chains via $INPUT */
export interface Sequential {
	kind: "sequential";
	steps: Runnable[];
	gate?: Gate; // validates final output of the sequence
	onFail?: OnFail; // retry = re-run entire sequence from scratch
	transform?: Transform; // applied to final output after gate passes
}

/** Pool — replicate ONE runnable N times with different inputs */
export interface Pool {
	kind: "pool";
	step: Runnable;
	count: number;
	merge: { strategy: MergeStrategy };
	gate?: Gate; // validates merged output
	onFail?: OnFail; // retry = re-run all N branches + re-merge
	transform?: Transform; // applied to merged output after gate passes
}

/** Parallel — run DIFFERENT runnables concurrently */
export interface Parallel {
	kind: "parallel";
	steps: Runnable[];
	merge: { strategy: MergeStrategy };
	gate?: Gate; // validates merged output
	onFail?: OnFail; // retry = re-run all branches + re-merge
	transform?: Transform; // applied to merged output after gate passes
}

/** Union type — any composable unit */
export type Runnable = Step | Sequential | Pool | Parallel;

// ── Runtime State ──────────────────────────────────────────────────────────

export type StepStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped";

export interface StepResult {
	label: string;
	status: StepStatus;
	output: string;
	gateResult?: { passed: boolean; reason: string };
	error?: string;
	elapsed: number; // ms
	group?: string; // parallel/pool group label this step belongs to
	toolCount?: number; // number of tools available to this step
}

export interface PipelineState {
	name: string;
	spec: Runnable;
	status: "idle" | "running" | "completed" | "failed";
	results: StepResult[];
	/** Labels of all steps currently executing (supports concurrent parallel/pool steps) */
	currentSteps: Set<string>;
	/** Accumulated stream text keyed by step label */
	currentStepStreams: Map<string, string>;
	startTime?: number;
	endTime?: number;
	finalOutput?: string;
}
