// ── Captain Pipeline Generator ─────────────────────────────────────────────
// Uses LLM to generate pipelines on-the-fly from available agents, gates, and steps.
// The LLM receives a structured context of everything available and produces a
// valid pipeline spec that's immediately registered and runnable.

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import { deserializeRunnable } from "./deserialize.js";
import type { Runnable } from "./types.js";

interface Agent {
	name: string;
	description: string;
	tools: string[];
	model?: string;
	source?: string;
}

// ── Gate & OnFail Catalogs ────────────────────────────────────────────────
// Human-readable descriptions so the LLM knows what's available

const GATE_CATALOG = `
## Available Gate Types

### Atomic Gates
- { type: "none" }                              — Always passes, no validation
- { type: "user", value: true }                 — Requires human approval (interactive UI)
- { type: "command", value: "<cmd>" }           — Run shell command; exit 0 = pass
- { type: "file", value: "<path>" }             — File must exist
- { type: "dir", value: "<path>" }              — Directory must exist
- { type: "assert", fn: "<expr>" }              — JS expression evaluated against \`output\` string

### Content Gates
- { type: "assert", fn: "output.includes('<needle>')" }              — Output contains string
- { type: "assert", fn: "output.toLowerCase().includes('<needle>')" } — Case-insensitive contains
- { type: "assert", fn: "output.length > <N>" }                      — Minimum output length

### Regex Gates
- { type: "regex", pattern: "<regex>", flags?: "<flags>" }  — Output must match regex

### JSON Gates
- { type: "json" }                                  — Output must be valid JSON
- { type: "json", schema: "key1,key2" }             — JSON must have these top-level keys

### HTTP Gates
- { type: "http", url: "<url>", method: "GET", expectedStatus: 200 }  — HTTP health check

### Combinator Gates
- { type: "multi", mode: "all", gates: [<gate>, ...] }  — All sub-gates must pass (AND)
- { type: "multi", mode: "any", gates: [<gate>, ...] }  — At least one must pass (OR)

### Environment Gates
- { type: "env", name: "<VAR>" }                    — Env var must be set
- { type: "env", name: "<VAR>", value: "<val>" }    — Env var must equal value

### LLM Evaluation Gates
- { type: "llm", prompt: "<criteria>", model?: "flash", threshold?: 0.7 }
  — Ask an LLM to evaluate the output against the criteria. The prompt can use $OUTPUT.
  — Good for subjective quality checks ("Is this well documented?", "Are edge cases covered?")

### Timeout Gate
- { type: "timeout", gate: <inner_gate>, ms: <milliseconds> }  — Wrap any gate with a timeout

### Common Preset Combinations
- Tests pass:       { type: "command", value: "bun test" }
- Typecheck:        { type: "command", value: "bunx tsc --noEmit" }
- Lint:             { type: "command", value: "bun run lint" }
- Test + Typecheck: { type: "command", value: "bun test && bunx tsc --noEmit" }
- Git clean:        { type: "command", value: "test -z \\"$(git status --porcelain)\\"" }
- Port listening:   { type: "command", value: "nc -z localhost <port>" }
`;

const ONFAIL_CATALOG = `
## Available OnFail Strategies
OnFail is a pure function (ctx: OnFailCtx) => OnFailResult.
All behaviour (retry limits, delays) lives inside the function — the executor only acts on the returned decision.

Presets (imported from gates/on-fail):
- retry                          — Retry up to 3 times, then fail (plain OnFail value, no call needed)
- retryWithDelay(max?, delayMs)  — Same but awaits delayMs inside the function before returning retry
- skip                           — Skip on failure, pass empty output downstream
- warn                           — Log warning but pass output through (non-blocking)
- fallback(step)                 — Run an alternative step on failure

Custom inline:
- ({ retryCount }) => retryCount < 2 ? { action: "retry" } : { action: "warn" }
- { action: "retry" }   { action: "fail" }   { action: "skip" }   { action: "warn" }
- ({ retryCount }) => retryCount < N ? { action: "retry" } : { action: "fail" }  // custom max
- { action: "fallback", step: <Step> }
`;

const RUNNABLE_SPEC = `
## Runnable Types (infinitely nestable)

### Step — atomic LLM invocation
{
  kind: "step",
  label: "<human-readable name>",
  tools: ["read", "bash", "edit", "write"],  // tool names available to this step
  model: "<model-id>",           // optional: e.g. "sonnet", "flash" (defaults to current session model)
  temperature: 0.2,              // optional: sampling temperature
  description: "<what this step does>",
  prompt: "<instructions for the step>",  // supports $INPUT (prev output) and $ORIGINAL (user request)
  gate: <Gate>,
  onFail: <OnFail>,
  transform: full                 // preset from transforms/presets: full | extract("key") | summarize() | inline fn
}

### Sequential — steps run in order, output chains via $INPUT
{
  kind: "sequential",
  steps: [<Runnable>, ...],
  gate?: <Gate>,      // validates final output of the sequence
  onFail?: <OnFail>   // retry = re-run entire sequence
}

### Pool — replicate ONE step N times in parallel (with git worktree isolation)
{
  kind: "pool",
  step: <Runnable>,
  count: <N>,
  merge: { strategy: "concat" | "awaitAll" | "firstPass" | "vote" | "rank" }
}

### Parallel — run DIFFERENT steps concurrently (with git worktree isolation)
{
  kind: "parallel",
  steps: [<Runnable>, ...],
  merge: { strategy: "concat" | "awaitAll" | "firstPass" | "vote" | "rank" }
}

## Merge Strategies
- "concat"    — Concatenate all outputs
- "awaitAll"  — Wait for all, return as structured list
- "firstPass" — Return the first output that passes its gate
- "vote"      — LLM picks the best output via voting
- "rank"      — LLM ranks outputs from best to worst, returns top
`;

// ── Build the LLM prompt ──────────────────────────────────────────────────

/** Build a structured prompt with all context for the LLM to generate a pipeline */
export function buildGeneratorPrompt(
	userGoal: string,
	agents: Record<string, Agent>,
): string {
	// Format available agents
	const agentLines = Object.values(agents)
		.map((a) => {
			const src = a.source === "md" ? "📄" : "⚡";
			const model = a.model ? ` model:${a.model}` : "";
			return `- ${src} ${a.name}: ${a.description} (tools: ${a.tools.join(", ")}${model})`;
		})
		.join("\n");

	return `You are a pipeline architect for the Captain orchestration system.
Your job is to generate a complete, executable pipeline spec based on the user's goal.

## Available Agents
${agentLines}

${GATE_CATALOG}

${ONFAIL_CATALOG}

${RUNNABLE_SPEC}

## Rules
1. ONLY use agents from the "Available Agents" list above. Never invent agent names.
2. Choose the most appropriate agents for each step based on their description and tools.
3. Use meaningful labels and descriptions for each step.
4. Write clear, detailed prompts that tell the agent exactly what to do.
5. Use $INPUT to reference the previous step's output and $ORIGINAL for the user's original request.
6. Choose appropriate gates — use "none" for exploratory steps, "command" for verification, "llm" for quality checks.
7. Choose appropriate onFail strategies — "retry" for important steps, "skip" for optional ones, "warn" for non-critical.
8. Use parallel/pool when steps are independent. Use sequential when output chains.
9. Prefer "concat" merge for complementary outputs, "rank" for competitive outputs, "vote" for consensus.
10. Keep pipelines focused — 3-7 steps is ideal. Don't over-engineer.

## Output Format
Respond with ONLY a valid JSON object. No markdown, no explanation, no code fences.
The JSON must have this shape:
{
  "name": "<kebab-case-pipeline-name>",
  "description": "<one-line description of what this pipeline does>",
  "pipeline": <Runnable>
}

## User's Goal
${userGoal}`;
}

// ── Parse & Validate ──────────────────────────────────────────────────────

export interface GeneratedPipeline {
	name: string;
	description: string;
	pipeline: Runnable;
}

/** Parse and validate the LLM's output into a GeneratedPipeline */
export function parseGeneratedPipeline(
	raw: string,
	availableAgents: Record<string, Agent>,
): GeneratedPipeline {
	// Strip markdown code fences if present (LLM sometimes wraps in ```json)
	let cleaned = raw.trim();
	const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) cleaned = fenceMatch[1]?.trim();

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(cleaned) as Record<string, unknown>;
	} catch (e) {
		throw new Error(
			`LLM output is not valid JSON: ${(e as Error).message}\n\nRaw output:\n${raw.slice(0, 500)}`,
		);
	}

	if (!parsed.name || typeof parsed.name !== "string") {
		throw new Error("Generated pipeline missing 'name' field");
	}
	const pipeline = parsed.pipeline as Record<string, unknown> | undefined;
	if (!pipeline?.kind) {
		throw new Error("Generated pipeline missing 'pipeline' with 'kind' field");
	}

	// Validate all agent references exist
	const unknownAgents = collectAgentRefs(pipeline).filter(
		(n) => !availableAgents[n],
	);
	if (unknownAgents.length > 0) {
		throw new Error(
			`Generated pipeline references unknown agent(s): ${unknownAgents.join(", ")}`,
		);
	}

	// Validate runnable structure (basic recursive check)
	validateRunnable(pipeline);

	// Deserialize JSON gate/onFail objects into their function equivalents
	const deserialized = deserializeRunnable(pipeline as unknown as Runnable);

	return {
		name: parsed.name as string,
		description: (parsed.description as string) ?? "",
		pipeline: deserialized,
	};
}

/** Unvalidated runnable shape from LLM output */
interface RawRunnable {
	kind?: string;
	label?: string;
	agent?: string;
	prompt?: string;
	tools?: string[];
	gate?: Record<string, unknown>;
	onFail?: Record<string, unknown>;
	transform?: Record<string, unknown>;
	description?: string;
	step?: RawRunnable;
	steps?: RawRunnable[];
	count?: number;
	merge?: Record<string, unknown>;
}

/** Validate step-kind runnable fields and apply defaults */
function validateStep(r: RawRunnable, path: string): void {
	if (!r.label) throw new Error(`Step at ${path} missing 'label'`);
	if (!r.prompt) throw new Error(`Step at ${path} missing 'prompt'`);
	if (!r.tools) r.tools = ["read", "bash", "edit", "write"];
	if (!r.gate) r.gate = { type: "none" };
	if (!r.onFail) r.onFail = { action: "skip" };
	if (!r.transform) r.transform = { kind: "full" }; // deserialized to full() by deserializeRunnable
	if (!r.description) r.description = r.label;
}

/** Validate steps array and recurse */
function validateStepsArray(
	steps: RawRunnable[] | undefined,
	kind: string,
	path: string,
): void {
	if (!Array.isArray(steps) || steps.length === 0) {
		throw new Error(`${kind} at ${path} must have non-empty 'steps' array`);
	}
	for (let i = 0; i < steps.length; i++) {
		validateRunnable(steps[i], `${path}.steps[${i}]`);
	}
}

/** Recursively validate a Runnable tree has required fields */
function validateRunnable(r: RawRunnable, path = "root"): void {
	if (!r?.kind) {
		throw new Error(`Invalid runnable at ${path}: missing 'kind'`);
	}

	switch (r.kind) {
		case "step":
			validateStep(r, path);
			break;

		case "sequential":
			validateStepsArray(r.steps, "Sequential", path);
			break;

		case "pool":
			if (!r.step) throw new Error(`Pool at ${path} missing 'step'`);
			if (!r.count || r.count < 1)
				throw new Error(`Pool at ${path} needs count >= 1`);
			if (!r.merge) r.merge = { strategy: "concat" };
			validateRunnable(r.step, `${path}.step`);
			break;

		case "parallel":
			validateStepsArray(r.steps, "Parallel", path);
			if (!r.merge) r.merge = { strategy: "concat" };
			break;

		default:
			throw new Error(`Unknown runnable kind "${r.kind}" at ${path}`);
	}
}

/** Recursively collect agent names from a runnable tree */
function collectAgentRefs(r: RawRunnable): string[] {
	if (!r?.kind) return [];
	switch (r.kind) {
		case "step":
			return r.agent ? [r.agent] : [];
		case "sequential":
			return (r.steps ?? []).flatMap(collectAgentRefs);
		case "pool":
			return r.step ? collectAgentRefs(r.step) : [];
		case "parallel":
			return (r.steps ?? []).flatMap(collectAgentRefs);
		default:
			return [];
	}
}

// ── Generate Pipeline via LLM ─────────────────────────────────────────────

/** Call the LLM to generate a pipeline, parse, validate, and return it */
export async function generatePipeline(
	userGoal: string,
	agents: Record<string, Agent>,
	model: Model<Api>,
	apiKey: string,
	signal?: AbortSignal,
): Promise<GeneratedPipeline> {
	const prompt = buildGeneratorPrompt(userGoal, agents);

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 4096, signal },
	);

	const raw = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return parseGeneratedPipeline(raw, agents);
}
