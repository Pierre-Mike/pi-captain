// ── Captain: Pipeline Orchestration Types ──────────────────────────────────

/** Known agent names from ~/.pi/agent/agents/*.md */
export type KnownAgent =
	| "architect"
	| "backend-dev"
	| "bowser"
	| "builder"
	| "canvas-renderer"
	| "captain"
	| "clarifier"
	| "decomposer"
	| "doc-writer"
	| "frontend-dev"
	| "plan-reviewer"
	| "planner"
	| "red-team"
	| "researcher"
	| "resolver"
	| "reviewer"
	| "scout"
	| "security-reviewer"
	| "shrinker"
	| "summarizer"
	| "synthesizer"
	| "tester"
	| "typescript-expert"
	| "validator";

/** Agent name — must match an agent defined in ~/.pi/agent/agents/*.md */
export type AgentName = KnownAgent;

/** Agent config — defines an LLM persona with tool access */
export interface Agent {
	name: AgentName;
	description: string;
	tools: string[]; // tool names available to this agent
	model?: string; // e.g. "sonnet", "flash" — resolved via modelRegistry
	temperature?: number;
	systemPrompt?: string; // system prompt for LLM calls (loaded from .md body)
	source?: "runtime" | "md"; // where this agent was defined
}

/** Gate — validation check after each step */
export type Gate =
	| { type: "command"; value: string } // shell command; exit 0 = pass
	| { type: "user"; value: true } // human approval via ctx.ui.confirm
	| { type: "file"; value: string } // file existence check
	| { type: "assert"; fn: string } // JS expression evaluated against output
	| { type: "none" } // no gate (always passes)
	// ── Extended Gate Types ──────────────────────────────────────────────────
	| { type: "regex"; pattern: string; flags?: string } // output must match regex
	| { type: "json"; schema?: string } // output must be valid JSON, optionally matching a shape
	| { type: "http"; url: string; method?: string; expectedStatus?: number } // HTTP health check
	| { type: "multi"; mode: "all" | "any"; gates: Gate[] } // combine gates with AND/OR logic
	| { type: "dir"; value: string } // directory existence check
	| { type: "env"; name: string; value?: string } // environment variable check
	| { type: "timeout"; gate: Gate; ms: number } // wrap any gate with a timeout
	// ── LLM Gate ─────────────────────────────────────────────────────────────
	| { type: "llm"; prompt: string; model?: string; threshold?: number }; // LLM-evaluated gate with confidence threshold

/** Failure handling strategy */
export type OnFail =
	| { action: "retry"; max?: number }
	| { action: "skip" }
	| { action: "fallback"; step: Step }
	| { action: "retryWithDelay"; max?: number; delayMs: number } // retry with backoff
	| { action: "warn" }; // log warning but pass through

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

/** Atomic unit — a single agent invocation */
export interface Step {
	kind: "step";
	label: string;
	agent: AgentName; // autocompletes known agents, validated at runtime
	description: string;
	prompt: string; // supports $INPUT, $ORIGINAL, ${var} interpolation
	gate: Gate;
	onFail: OnFail;
	transform: Transform;

	/** Max LLM turns before forcing stop (default: 10). Prevents runaway loops. */
	maxTurns?: number;

	/** Max output tokens per LLM call in this step (default: 8192). */
	maxTokens?: number;
}

/** Sequential — run in order, output chains via $INPUT */
export interface Sequential {
	kind: "sequential";
	steps: Runnable[];
	gate?: Gate; // validates final output of the sequence
	onFail?: OnFail; // retry = re-run entire sequence from scratch
}

/** Pool — replicate ONE runnable N times with different inputs */
export interface Pool {
	kind: "pool";
	step: Runnable;
	count: number;
	merge: { strategy: MergeStrategy };
	gate?: Gate; // validates merged output
	onFail?: OnFail; // retry = re-run all N branches + re-merge
}

/** Parallel — run DIFFERENT runnables concurrently */
export interface Parallel {
	kind: "parallel";
	steps: Runnable[];
	merge: { strategy: MergeStrategy };
	gate?: Gate; // validates merged output
	onFail?: OnFail; // retry = re-run all branches + re-merge
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
}

export interface PipelineState {
	name: string;
	spec: Runnable;
	status: "idle" | "running" | "completed" | "failed";
	results: StepResult[];
	startTime?: number;
	endTime?: number;
	finalOutput?: string;
}

/** Persisted state for session reconstruction */
export interface CaptainDetails {
	pipelines: Record<string, { spec: Runnable }>;
	agents: Record<string, Agent>;
	lastRun?: {
		name: string;
		state: PipelineState;
	};
}
