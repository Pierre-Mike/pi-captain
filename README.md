# pi-captain

Multi-agent pipeline orchestrator for [pi](https://github.com/badlogic/pi-mono). Define specialized agents, wire them into sequential/parallel/pool pipelines with quality gates, and run complex workflows.

## Install

```bash
# Project-local (recommended — auto-installs for teammates)
pi install -l git:github.com/Pierre-Mike/pi-captain

# Global
pi install git:github.com/Pierre-Mike/pi-captain
```

## What You Get

### Tools

| Tool | Description |
|------|-------------|
| `captain_agent` | Define a reusable named agent (model, tools, systemPrompt) |
| `captain_define` | Wire steps into a pipeline (sequential / parallel / pool) |
| `captain_run` | Execute a pipeline with input |
| `captain_status` | Check pipeline progress and results |
| `captain_list` | List all defined pipelines |
| `captain_load` | Load a builtin pipeline preset |
| `captain_generate` | Auto-generate a pipeline from a goal description |

### Builtin Pipeline Presets

| Preset | Description |
|--------|-------------|
| `captain:shredder` | Clarify → decompose → shred to atomic units → validate → resolve deps → generate pipeline spec → Obsidian canvas |
| `captain:spec-tdd` | Spec → TDD red → TDD green + docs (parallel) → review → PR |
| `captain:requirements-gathering` | Explore → deep-dive → challenge → synthesize REQUIREMENTS.md |

---

## Type Reference

This section is the authoritative schema for the pipeline spec. Every field is described with its type, whether it is required or optional, and its default value.

---

### `Runnable` (union)

A `Runnable` is anything that can be placed inside a pipeline. All four variants are infinitely nestable.

```
Runnable = Step | Sequential | Pool | Parallel
```

---

### `Step` — atomic agent invocation

```ts
{
  kind: "step",                    // required — literal "step"
  label: string,                   // required — human-readable name shown in UI
  prompt: string,                  // required — instructions for the agent
                                   //   $INPUT    → output of the previous step (or user input on step 1)
                                   //   $ORIGINAL → the original user request, always unchanged

  // ── Agent (pick one or combine) ───────────────────────────────────────
  agent?: AgentName,               // optional — named agent (see Agent Names below)
                                   //   Inline fields below OVERRIDE the named agent when both are set.

  // ── Inline agent config (can be used WITHOUT an agent name) ───────────
  model?: string,                  // optional — model identifier; default: current session model
                                   //   Examples: "sonnet", "flash", "claude-opus-4-5", "claude-haiku-4-5"
  tools?: string[],                // optional — tool names to enable
                                   //   Default: ["read","bash","edit","write"]
                                   //   Available: "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"
  systemPrompt?: string,           // optional — system prompt for the LLM (overrides agent default)
  skills?: string[],               // optional — absolute paths to .md skill files to inject
  extensions?: string[],           // optional — absolute paths to .ts extension files to load
  jsonOutput?: boolean,            // optional — if true, instructs agent to return structured JSON; default: false

  // ── Step metadata ─────────────────────────────────────────────────────
  description?: string,            // optional — longer description (defaults to label)
  maxTurns?: number,               // optional — cap agent turns (declared intent, not yet enforced)
  maxTokens?: number,              // optional — cap output tokens (declared intent, not yet enforced)

  // ── Lifecycle ─────────────────────────────────────────────────────────
  gate: Gate,                      // required — validation after this step runs
  onFail: OnFail,                  // required — what to do if gate fails or step errors
  transform: Transform,            // required — how to pass output to the next step
}
```

**Minimal inline step (no agent file required):**
```json
{
  "kind": "step",
  "label": "Analyze codebase",
  "model": "flash",
  "tools": ["read", "bash"],
  "prompt": "Analyze $ORIGINAL and summarize the architecture.",
  "gate": { "type": "none" },
  "onFail": { "action": "skip" },
  "transform": { "kind": "full" }
}
```

**Step using a named agent:**
```json
{
  "kind": "step",
  "label": "Implement feature",
  "agent": "backend-dev",
  "prompt": "Implement: $ORIGINAL\n\nContext from analysis:\n$INPUT",
  "gate": { "type": "command", "value": "bun test" },
  "onFail": { "action": "retry", "max": 3 },
  "transform": { "kind": "full" }
}
```

**Step overriding named agent's model:**
```json
{
  "kind": "step",
  "label": "Quick review",
  "agent": "reviewer",
  "model": "flash",
  "prompt": "Review $INPUT for obvious issues.",
  "gate": { "type": "none" },
  "onFail": { "action": "warn" },
  "transform": { "kind": "summarize" }
}
```

---

### `Sequential` — ordered chain

Steps run one after another. The output of each step becomes `$INPUT` for the next.

```ts
{
  kind: "sequential",              // required — literal "sequential"
  steps: Runnable[],               // required — non-empty array of any Runnable
  gate?: Gate,                     // optional — validates the FINAL output of the whole sequence
  onFail?: OnFail,                 // optional — retry = re-run the entire sequence from scratch
}
```

```json
{
  "kind": "sequential",
  "steps": [
    { "kind": "step", "label": "Plan", ... },
    { "kind": "step", "label": "Implement", ... },
    { "kind": "step", "label": "Test", ... }
  ],
  "gate": { "type": "command", "value": "bun test" },
  "onFail": { "action": "retry", "max": 2 }
}
```

---

### `Pool` — same step, N times in parallel

Runs ONE runnable `count` times simultaneously (each in its own git worktree for isolation), then merges results.

```ts
{
  kind: "pool",                    // required — literal "pool"
  step: Runnable,                  // required — the runnable to replicate
  count: number,                   // required — number of parallel instances (>= 1)
  merge: { strategy: MergeStrategy }, // required — how to combine the N outputs
  gate?: Gate,                     // optional — validates the merged output
  onFail?: OnFail,                 // optional — retry = re-run all N branches + re-merge
}
```

```json
{
  "kind": "pool",
  "step": {
    "kind": "step",
    "label": "Generate solution",
    "agent": "backend-dev",
    "prompt": "Implement $ORIGINAL",
    "gate": { "type": "none" },
    "onFail": { "action": "skip" },
    "transform": { "kind": "full" }
  },
  "count": 3,
  "merge": { "strategy": "rank" }
}
```

---

### `Parallel` — different steps concurrently

Runs DIFFERENT runnables at the same time (each in its own git worktree), then merges results.

```ts
{
  kind: "parallel",                // required — literal "parallel"
  steps: Runnable[],               // required — non-empty array, each runs concurrently
  merge: { strategy: MergeStrategy }, // required — how to combine all outputs
  gate?: Gate,                     // optional — validates the merged output
  onFail?: OnFail,                 // optional — retry = re-run all branches + re-merge
}
```

```json
{
  "kind": "parallel",
  "steps": [
    { "kind": "step", "label": "Security review", "agent": "security-reviewer", ... },
    { "kind": "step", "label": "Performance review", "agent": "reviewer", ... }
  ],
  "merge": { "strategy": "concat" }
}
```

---

### `Gate` — output validation

A gate runs after a step completes. If it fails, `onFail` is triggered.

```ts
type Gate =
  // ── Always pass ───────────────────────────────────────────────────────
  | { type: "none" }
  //   Use for: exploratory steps, first steps where output quality isn't critical.

  // ── Human approval ────────────────────────────────────────────────────
  | { type: "user"; value: true }
  //   Use for: risky operations, PR creation, deployments.

  // ── Shell command ─────────────────────────────────────────────────────
  | { type: "command"; value: string }
  //   Exit code 0 = pass, non-zero = fail.
  //   Use for: running tests, type-checking, linting, health checks.
  //   Examples:
  //     { type: "command", value: "bun test" }
  //     { type: "command", value: "bun test && bunx tsc --noEmit" }
  //     { type: "command", value: "bun run lint" }
  //     { type: "command", value: "nc -z localhost 3000" }
  //     { type: "command", value: "test -z \"$(git status --porcelain)\"" }

  // ── File / directory existence ────────────────────────────────────────
  | { type: "file"; value: string }
  //   Passes if the file at `value` exists.
  | { type: "dir"; value: string }
  //   Passes if the directory at `value` exists.

  // ── JS assertion on output ────────────────────────────────────────────
  | { type: "assert"; fn: string }
  //   `fn` is a JS expression; `output` is the step's output string.
  //   Examples:
  //     { type: "assert", fn: "output.includes('LGTM')" }
  //     { type: "assert", fn: "output.length > 100" }
  //     { type: "assert", fn: "output.toLowerCase().includes('no issues')" }

  // ── Regex match ───────────────────────────────────────────────────────
  | { type: "regex"; pattern: string; flags?: string }
  //   Output must match the regex.
  //   Examples:
  //     { type: "regex", pattern: "^\\{", flags: "m" }   ← output starts with {
  //     { type: "regex", pattern: "PASS|OK", flags: "i" }

  // ── Valid JSON ────────────────────────────────────────────────────────
  | { type: "json" }
  //   Output must be parseable as JSON.
  | { type: "json"; schema: string }
  //   Comma-separated top-level keys that must be present.
  //   Example: { type: "json", schema: "name,pipeline,description" }

  // ── HTTP health check ─────────────────────────────────────────────────
  | { type: "http"; url: string; method?: string; expectedStatus?: number }
  //   Performs an HTTP request; passes if status matches expectedStatus (default 200).
  //   Example: { type: "http", url: "http://localhost:3000/health", expectedStatus: 200 }

  // ── Environment variable ──────────────────────────────────────────────
  | { type: "env"; name: string; value?: string }
  //   Passes if env var `name` is set (and optionally equals `value`).
  //   Example: { type: "env", name: "DATABASE_URL" }

  // ── LLM evaluation ────────────────────────────────────────────────────
  | { type: "llm"; prompt: string; model?: string; threshold?: number }
  //   Asks an LLM to evaluate the step output against `prompt`.
  //   Returns a confidence score 0–1; passes if score >= threshold (default 0.7).
  //   `prompt` can reference $OUTPUT.
  //   Use for: subjective quality checks where rules can't cover every case.
  //   Examples:
  //     { type: "llm", prompt: "Is the output well documented and readable?", threshold: 0.8 }
  //     { type: "llm", prompt: "Does $OUTPUT cover all edge cases mentioned in $ORIGINAL?", model: "flash" }

  // ── Timeout wrapper ───────────────────────────────────────────────────
  | { type: "timeout"; gate: Gate; ms: number }
  //   Wraps any gate; fails if inner gate takes longer than `ms` milliseconds.
  //   Example: { type: "timeout", gate: { type: "command", value: "bun test" }, ms: 60000 }

  // ── Combinator ────────────────────────────────────────────────────────
  | { type: "multi"; mode: "all" | "any"; gates: Gate[] }
  //   "all": ALL sub-gates must pass (AND logic)
  //   "any": AT LEAST ONE sub-gate must pass (OR logic)
  //   Example:
  //     { type: "multi", mode: "all", gates: [
  //         { type: "command", value: "bun test" },
  //         { type: "llm", prompt: "Is this code production-ready?" }
  //     ]}
```

---

### `OnFail` — failure handling

```ts
type OnFail =
  | { action: "retry"; max?: number }
  //   Re-run the step (or whole sequence/pool/parallel) up to `max` times. Default max: 3.
  //   Use for: important steps that may need multiple attempts (LLM generation, network calls).

  | { action: "retryWithDelay"; max?: number; delayMs: number }
  //   Same as retry but waits `delayMs` ms between attempts.
  //   Use for: rate-limited APIs, services that need time to recover.

  | { action: "skip" }
  //   Swallow the failure, pass empty string downstream. Pipeline continues.
  //   Use for: optional enrichment steps where failure is acceptable.

  | { action: "warn" }
  //   Log a warning but pass the (possibly failing) output downstream. Non-blocking.
  //   Use for: nice-to-have checks that should not block the pipeline.

  | { action: "fallback"; step: Step }
  //   On failure, run an alternative Step and use its output instead.
  //   Use for: expensive primary steps with a cheap fallback.
```

---

### `Transform` — output shaping

Controls what is passed as `$INPUT` to the next step.

```ts
type Transform =
  | { kind: "full" }
  //   Pass the entire raw output string. Default choice.

  | { kind: "extract"; key: string }
  //   Parse output as JSON and extract the value at `key`.
  //   Use with jsonOutput: true steps.
  //   Example: { kind: "extract", key: "issues" }

  | { kind: "summarize" }
  //   Ask an LLM to produce a concise summary of the output.
  //   Use when output is very long and only a summary is needed downstream.
```

---

### `MergeStrategy` — combining parallel/pool outputs

| Strategy | Behaviour |
|----------|-----------|
| `"concat"` | Concatenate all outputs in order. Best for complementary work (security + perf review). |
| `"awaitAll"` | Wait for all, return as a structured list. Best when the next step needs all outputs explicitly. |
| `"firstPass"` | Return the first output that passes its gate, ignore the rest. Best for race conditions. |
| `"vote"` | LLM picks the single best output by majority vote. Best for consensus decisions. |
| `"rank"` | LLM ranks all outputs and returns the top one. Best for competitive generation (3 drafts → best). |

---

### `AgentName` — built-in agents

These agents are bundled in the repo and available without any setup. Your own agents (in `~/.pi/agent/agents/` or `.claude/agents/`) take precedence and can override bundled ones.

| Name | Role |
|------|------|
| `architect` | System design, high-level decisions |
| `backend-dev` | Server-side implementation |
| `builder` | Build, compile, run scripts |
| `canvas-renderer` | Generate Obsidian canvas JSON |
| `captain` | Pipeline orchestration decisions |
| `clarifier` | Ask clarifying questions, resolve ambiguity |
| `decomposer` | Break work into atomic tasks |
| `doc-writer` | Write documentation, READMEs |
| `frontend-dev` | UI/UX implementation |
| `plan-reviewer` | Critique and validate plans |
| `planner` | Create step-by-step plans |
| `red-team` | Adversarial review, find holes |
| `researcher` | Gather info, explore codebases |
| `resolver` | Resolve conflicts, dependencies |
| `reviewer` | Code review |
| `scout` | Explore and map unfamiliar codebases |
| `security-reviewer` | Security audit |
| `shrinker` | Simplify, trim, reduce |
| `summarizer` | Summarize long content |
| `synthesizer` | Combine multiple inputs into one |
| `tester` | Write and run tests |
| `typescript-expert` | TypeScript-specific work |
| `validator` | Validate output against criteria |
| `bowser` | Browser/web automation |
| **Spec-TDD pipeline** | |
| `spec-writer` | Write detailed specs |
| `tdd-red` | Write failing tests first |
| `tdd-green` | Make tests pass |
| `code-reviewer` | Deep code review |
| `review-fixer` | Apply review feedback |
| `pr-preparer` | Prepare PR description |
| **Requirements pipeline** | |
| `explorer` | Broad initial exploration |
| `deep-diver` | Deep investigation of specific areas |
| `challenger` | Challenge assumptions |
| `req-synthesizer` | Synthesize into REQUIREMENTS.md |

---

## Complete Pipeline Example

```json
{
  "name": "feature-implementation",
  "pipeline": {
    "kind": "sequential",
    "steps": [
      {
        "kind": "step",
        "label": "Explore codebase",
        "agent": "scout",
        "prompt": "Explore the codebase and understand how to implement: $ORIGINAL. Identify relevant files, patterns, and constraints.",
        "gate": { "type": "none" },
        "onFail": { "action": "skip" },
        "transform": { "kind": "full" }
      },
      {
        "kind": "parallel",
        "steps": [
          {
            "kind": "step",
            "label": "Write tests",
            "agent": "tester",
            "prompt": "Based on this analysis:\n$INPUT\n\nWrite failing tests for: $ORIGINAL",
            "gate": { "type": "command", "value": "bun test --bail 2>&1 | grep -q 'fail'" },
            "onFail": { "action": "retry", "max": 2 },
            "transform": { "kind": "full" }
          },
          {
            "kind": "step",
            "label": "Write docs",
            "agent": "doc-writer",
            "prompt": "Based on this analysis:\n$INPUT\n\nDraft documentation for: $ORIGINAL",
            "gate": { "type": "none" },
            "onFail": { "action": "warn" },
            "transform": { "kind": "full" }
          }
        ],
        "merge": { "strategy": "concat" }
      },
      {
        "kind": "step",
        "label": "Implement",
        "agent": "backend-dev",
        "prompt": "Context:\n$INPUT\n\nImplement: $ORIGINAL\nMake all tests pass.",
        "gate": { "type": "command", "value": "bun test" },
        "onFail": { "action": "retry", "max": 3 },
        "transform": { "kind": "full" }
      },
      {
        "kind": "step",
        "label": "Review",
        "agent": "reviewer",
        "model": "flash",
        "prompt": "Review the implementation for $ORIGINAL. Focus on correctness, security, and maintainability.",
        "gate": {
          "type": "llm",
          "prompt": "Does the review indicate the implementation is ready for production?",
          "threshold": 0.8
        },
        "onFail": { "action": "retry", "max": 1 },
        "transform": { "kind": "summarize" }
      }
    ]
  }
}
```

---

## Quick Start

```
# Load and run a builtin preset
> Use captain to review my PR

# Generate a custom pipeline on the fly
> Use captain to refactor the auth module and ensure all tests pass

# Define a custom inline pipeline (no agent setup needed)
> Define a captain pipeline: first analyze with flash+read tools,
  then implement with sonnet+all tools, then run bun test as a gate
```

---

## Development

```bash
git clone https://github.com/Pierre-Mike/pi-captain.git
cd pi-captain
npm install

# Add as local package for development
# In ~/.pi/agent/settings.json or .pi/settings.json:
{ "packages": ["/path/to/pi-captain"] }

# Edit files, then /reload in pi to pick up changes
```

### Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm run check` | `biome check extensions/ skills/` | Lint & format check (CI / pre-push) |
| `npm run fix` | `biome check --write extensions/ skills/` | Auto-fix lint & format issues |
| `npm run format` | `biome format --write extensions/ skills/` | Format only |

### Git Hooks

| Hook | What runs | Purpose |
|------|-----------|---------|
| **pre-commit** | `lint-staged` → `biome check --write` on staged `*.{ts,js,json}` | Auto-fix and gate staged files before commit |
| **pre-push** | `npm run check` | Full lint & format check on the entire codebase before push |

## License

MIT
