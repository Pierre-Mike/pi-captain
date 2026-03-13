// ── Captain: Pipeline Orchestration Types ──────────────────────────────────
// Gate/OnFail/Transform primitives live in gate-types.ts.
// Step lifecycle hooks live in hook-types.ts.

export type {
	Gate,
	GateCtx,
	MergeFn,
	OnFail,
	OnFailCtx,
	OnFailResult,
	Transform,
	TransformCtx,
} from "./gate-types.js";
export type {
	StepHookCtx,
	StepHooks,
	ToolHookCtx,
} from "./hook-types.js";
export type { ModelRegistryLike } from "./utils/model.js";

/** Known shorthands or any full model ID string. */
export type ModelId = "sonnet" | "flash" | "haiku" | "opus" | (string & {});

/** Atomic unit — a single `pi --print` invocation */
export interface Step {
	readonly kind: "step";
	readonly label: string;

	readonly model?: ModelId;
	readonly tools?: readonly string[];
	readonly systemPrompt?: string;
	readonly skills?: readonly string[];
	readonly extensions?: readonly string[];
	readonly jsonOutput?: boolean;
	readonly description?: string;
	readonly prompt: string;

	readonly gate?: import("./gate-types.js").Gate;
	readonly onFail?: import("./gate-types.js").OnFail;
	readonly transform?: import("./gate-types.js").Transform;
	/** Per-step lifecycle hooks — run before the matching ExecutorContext callback. */
	readonly hooks?: import("./hook-types.js").StepHooks;
}

/** Sequential — run in order, output chains via $INPUT */
export interface Sequential {
	readonly kind: "sequential";
	readonly steps: readonly Runnable[];
	readonly gate?: import("./gate-types.js").Gate;
	readonly onFail?: import("./gate-types.js").OnFail;
	readonly transform?: import("./gate-types.js").Transform;
}

/** Pool — replicate ONE runnable N times */
export interface Pool {
	readonly kind: "pool";
	readonly step: Runnable;
	readonly count: number;
	readonly merge: import("./gate-types.js").MergeFn;
	readonly gate?: import("./gate-types.js").Gate;
	readonly onFail?: import("./gate-types.js").OnFail;
	readonly transform?: import("./gate-types.js").Transform;
}

/** Parallel — run DIFFERENT runnables concurrently */
export interface Parallel {
	readonly kind: "parallel";
	readonly steps: readonly Runnable[];
	readonly merge: import("./gate-types.js").MergeFn;
	readonly gate?: import("./gate-types.js").Gate;
	readonly onFail?: import("./gate-types.js").OnFail;
	readonly transform?: import("./gate-types.js").Transform;
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
	readonly label: string;
	status: StepStatus;
	output: string;
	gateResult?: { readonly passed: boolean; readonly reason: string };
	error?: string;
	elapsed: number;
	group?: string;
	readonly toolCount?: number;
	toolCallCount?: number;
	model?: string;
}

export interface PipelineState {
	readonly name: string;
	readonly spec: Runnable;
	status: "idle" | "running" | "completed" | "failed" | "cancelled";
	results: StepResult[];
	readonly currentSteps: Set<string>;
	readonly currentStepStreams: Map<string, string>;
	readonly currentStepToolCalls: Map<string, number>;
	startTime?: number;
	endTime?: number;
	finalOutput?: string;
	jobId?: number;
}
