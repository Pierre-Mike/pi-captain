// ── Runtime State Types ────────────────────────────────────────────────────
// Mutable execution state — separate from the immutable pipeline composition
// types in types.ts to keep each file within the 200-line limit.

import type { Runnable } from "./types.js";

export type StepStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "skipped";

export interface StepResult {
	readonly label: string;
	status: StepStatus; // mutable: updated during execution
	output: string; // mutable: accumulated during execution
	gateResult?: { readonly passed: boolean; readonly reason: string };
	error?: string;
	elapsed: number;
	group?: string; // assigned after construction by parallel/pool composition
	readonly toolCount?: number;
	toolCallCount?: number;
	model?: string;
}

export interface PipelineState {
	readonly name: string;
	readonly spec: Runnable;
	status: "idle" | "running" | "completed" | "failed";
	results: StepResult[];
	/** Labels of all steps currently executing */
	readonly currentSteps: Set<string>;
	/** Accumulated stream text keyed by step label */
	readonly currentStepStreams: Map<string, string>;
	/** Live tool-call count keyed by step label */
	readonly currentStepToolCalls: Map<string, number>;
	startTime?: number;
	endTime?: number;
	finalOutput?: string;
}
