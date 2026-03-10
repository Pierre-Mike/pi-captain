# pi-captain

Pipeline orchestrator for [pi](https://github.com/badlogic/pi-mono). Wire steps into sequential/parallel/pool pipelines with quality gates and run complex workflows — each step declares its own model, tools, and temperature inline.

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
| `captain_define` | Wire steps into a pipeline (sequential / parallel / pool) |
| `captain_run` | Execute a pipeline with input |
| `captain_status` | Check pipeline progress and results |
| `captain_list` | List all defined pipelines |
| `captain_load` | Load a builtin pipeline preset or `.ts` pipeline file |
| `captain_generate` | Auto-generate a pipeline from a goal description |

### Builtin Pipeline Presets

| Preset | Description |
|--------|-------------|
| `captain:shredder` | Clarify → decompose → shred to atomic units → validate → resolve deps → generate pipeline spec → Obsidian canvas |
| `captain:spec-tdd` | Spec → TDD red → TDD green + docs (parallel) → review → PR |
| `captain:requirements-gathering` | Explore → deep-dive → challenge → synthesize REQUIREMENTS.md |
| `captain:github-pr-review` | Fetch PR metadata → review each file → synthesize verdict |
| `captain:showcase` | Demonstrates gates, retries, closures, and transforms |

---

## Pipelines as TypeScript Files

The preferred way to write pipelines is as `.ts` files that export a `pipeline` const of type `Runnable`. Gates, OnFail handlers, and Transforms are **plain functions** — no JSON encoding needed.

```ts
// my-pipeline.ts
import { retry, skip, warn } from "<captain>/gates/on-fail.js";
import { bunTest, command, regexCI, user } from "<captain>/gates/presets.js";
import { llmFast } from "<captain>/gates/llm.js";
import { full, summarize } from "<captain>/transforms/presets.js";
import type { Runnable, Step } from "<captain>/types.js";

const research: Step = {
  kind: "step",
  label: "Research",
  model: "sonnet",
  tools: ["read", "bash"],
  prompt: "Research the following topic thoroughly:\n$ORIGINAL",
  gate: undefined,
  onFail: skip,
  transform: full,
};

const implement: Step = {
  kind: "step",
  label: "Implement",
  model: "sonnet",
  tools: ["read", "bash", "edit", "write"],
  prompt: "Based on this research:\n$INPUT\n\nImplement: $ORIGINAL",
  gate: bunTest,           // runs `bun test`, passes on exit 0
  onFail: retry(3),
  transform: full,
};

const review: Step = {
  kind: "step",
  label: "Review",
  model: "flash",
  tools: ["read", "bash"],
  temperature: 0.3,
  prompt: "Review this implementation:\n$INPUT\n\nOriginal: $ORIGINAL",
  gate: user,              // human approval in interactive UI
  onFail: skip,
  transform: summarize(),
};

export const pipeline: Runnable = {
  kind: "sequential",
  steps: [research, implement, review],
};
```

Load and run:

```
captain_load: action="load", name="./my-pipeline.ts"
captain_run: name="my-pipeline", input="Build a REST API for user management"
```

---

## Type Reference

---

### `Runnable` (union)

A `Runnable` is anything that can be placed inside a pipeline. All four variants are infinitely nestable.

```
Runnable = Step | Sequential | Pool | Parallel
```

---

### `Step` — atomic LLM invocation

Each step runs as an in-process pi SDK session. All config is declared inline on the step.

```ts
{
  kind: "step",                    // required — literal "step"
  label: string,                   // required — human-readable name shown in UI
  prompt: string,                  // required — instructions for the step
                                   //   $INPUT    → output of the previous step (or user input on step 1)
                                   //   $ORIGINAL → the original user request, always unchanged

  // ── Step config ───────────────────────────────────────────────────────
  model?: string,                  // optional — model identifier; default: current session model
                                   //   Examples: "sonnet", "flash", "claude-opus-4-5"
  tools?: string[],                // optional — tool names to enable
                                   //   Default: ["read","bash","edit","write"]
                                   //   Available: "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls"
  temperature?: number,            // optional — sampling temperature (0–1)
  systemPrompt?: string,           // optional — system prompt for the LLM session
  skills?: string[],               // optional — absolute paths to .md skill files to inject
  extensions?: string[],           // optional — absolute paths to .ts extension files to load
  jsonOutput?: boolean,            // optional — if true, instructs step to return structured JSON; default: false

  // ── Step metadata ─────────────────────────────────────────────────────
  description?: string,            // optional — longer description (defaults to label)

  // ── Lifecycle ─────────────────────────────────────────────────────────
  gate?: Gate,                     // optional — validation after this step runs
  onFail?: OnFail,                 // optional — what to do if gate fails or step errors
  transform: Transform,            // required — how to pass output to the next step
}
```

**Example step (TypeScript):**
```ts
import { bunTest } from "<captain>/gates/presets.js";
import { retry } from "<captain>/gates/on-fail.js";
import { full } from "<captain>/transforms/presets.js";

const buildStep: Step = {
  kind: "step",
  label: "Build & Test",
  model: "sonnet",
  tools: ["read", "bash", "edit", "write"],
  prompt: "Implement $ORIGINAL. Make all tests pass.",
  gate: bunTest,
  onFail: retry(3),
  transform: full,
};
```

---

### `Gate` — plain validation function

A gate is a **plain function** that receives the step output and optional side-effect context.  
Return `true` to pass, or a `string` describing why it failed. Throwing is also treated as a failure.

```ts
type Gate = (params: {
  output: string;
  ctx?: GateCtx;
}) => true | string | Promise<true | string>;
```

**Inline gates:**
```ts
// Simple content check
gate: ({ output }) => output.includes("DONE") ? true : 'Output must contain "DONE"'

// JSON validity check
gate: ({ output }) => {
  try { JSON.parse(output.trim()); return true; }
  catch { return "Output is not valid JSON"; }
}

// Shell command via ctx
gate: async ({ ctx }) => {
  const { code, stderr } = await ctx!.exec("bash", ["-c", "bun test"]);
  return code === 0 ? true : `Tests failed: ${stderr.slice(0, 200)}`;
}

// Stateful gate using closure
let attempts = 0;
gate: ({ output }) => {
  attempts++;
  return attempts >= 3 ? true : `Need 3 attempts, got ${attempts}`;
}
```

**Gate presets** (import from `gates/presets.js`):

| Export | Description |
|--------|-------------|
| `bunTest` | `bun test` exits 0 |
| `bunTypecheck` | `bunx tsc --noEmit` exits 0 |
| `bunLint` | `bun run lint` exits 0 |
| `command(cmd)` | Any shell command, exit 0 = pass |
| `commandAll(...cmds)` | All shell commands must pass (joined with `&&`) |
| `file(path)` | File must exist |
| `dir(path)` | Directory must exist |
| `regex(pattern, flags?)` | Output must match regex |
| `regexCI(pattern)` | Case-insensitive regex match |
| `regexExcludes(pattern)` | Output must NOT match regex |
| `outputIncludes(s)` | Output contains string (case-sensitive) |
| `outputIncludesCI(s)` | Output contains string (case-insensitive) |
| `outputMinLength(n)` | Output at least N characters |
| `jsonValid` | Output is valid JSON |
| `jsonHasKeys(...keys)` | Valid JSON with required top-level keys |
| `httpOk(url)` | GET returns 200 |
| `httpStatus(url, status, method?)` | Specific HTTP status |
| `portListening(port, host?)` | TCP port is open |
| `dockerRunning(name)` | Docker container is running |
| `envSet(name)` | Env var is set and non-empty |
| `envEquals(name, value)` | Env var equals a specific value |
| `gitClean` | Working directory has no uncommitted changes |
| `gitBranch(name)` | Current branch matches name |
| `noConflicts` | No merge conflict markers in source files |
| `allOf(...gates)` | All sub-gates must pass (AND) |
| `anyOf(...gates)` | At least one must pass (OR) |
| `withTimeout(gate, ms)` | Fail if gate takes longer than ms |
| `user` | Human approval via UI confirm dialog |
| `none` | Always passes |
| `testAndTypecheck` | `bun test && bunx tsc --noEmit` |
| `fullCI` | test + typecheck + lint |
| `prodReady` | tests + typecheck + build artifact |
| `distExists` | `dist/index.js` exists |

**LLM gate** (import from `gates/llm.js`):

| Export | Description |
|--------|-------------|
| `llmFast(prompt, threshold?)` | LLM evaluates output quality (0–1 threshold, default 0.7) |

```ts
import { llmFast } from "<captain>/gates/llm.js";
gate: llmFast("Is this implementation production-ready?", 0.8)
```

---

### `OnFail` — plain failure-handling function

An `OnFail` is a **plain function** that receives failure context and returns what to do next.

```ts
type OnFail = (ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>;

interface OnFailCtx {
  reason: string;      // Gate failure reason
  retryCount: number;  // Retries already attempted (0 on first failure)
  stepCount: number;   // Total times step has run (retryCount + 1)
  output: string;      // Last output before failure
}

type OnFailResult =
  | { action: "retry" }
  | { action: "fail" }
  | { action: "skip" }
  | { action: "warn" }
  | { action: "fallback"; step: Step };
```

**OnFail presets** (import from `gates/on-fail.js`):

| Export | Description |
|--------|-------------|
| `retry(max?)` | Re-run up to N times (default 3), then fail |
| `retryWithDelay(max, delayMs)` | Retry with pause between attempts |
| `skip` | Mark as skipped, pass empty string downstream |
| `warn` | Log warning, treat as passed |
| `fallback(step)` | Run an alternative step instead |

**Custom inline:**
```ts
// Retry twice, then warn
onFail: ({ retryCount }) => retryCount < 2 ? { action: "retry" } : { action: "warn" }
```

**When to use `warn` vs `skip`:**
- **`warn`**: Gate failed but output is still useful — pass it through. Good for advisory gates.
- **`skip`**: Gate failed and output is unreliable — discard it. Good for mandatory validation.

---

### `Transform` — plain output-shaping function

A transform is a **plain function** that maps one step's output to the next step's input.

```ts
type Transform = (params: {
  output: string;    // Raw output produced by the step
  original: string;  // The very first pipeline input ($ORIGINAL)
  ctx: TransformCtx; // Side-effect helpers (shell, LLM, …)
}) => string | Promise<string>;
```

**Transform presets** (import from `transforms/presets.js`):

| Export | Description |
|--------|-------------|
| `full` | Pass entire output unchanged (default) |
| `extract(key)` | Parse JSON and extract a top-level key |
| `summarize()` | Ask LLM to summarize in 2–3 sentences |

**Inline transforms:**
```ts
// Trim whitespace
transform: ({ output }) => output.trim()

// Pull JSON key with fallback
transform: ({ output }) => {
  try { return JSON.parse(output).result; }
  catch { return output; }
}

// Shell post-processing
transform: async ({ output, ctx }) => {
  const { stdout } = await ctx.exec("jq", ["-r", ".items[]"]);
  return stdout || output;
}
```

---

### `Sequential` — chain steps via `$INPUT`

```ts
{
  kind: "sequential",
  steps: Runnable[],      // ordered list of steps/sub-pipelines
  gate?: Gate,            // validates final output of the sequence
  onFail?: OnFail,        // retry = re-run entire sequence from scratch
  transform?: Transform,  // applied to final output after gate passes
}
```

### `Parallel` — different steps concurrently

```ts
{
  kind: "parallel",
  steps: Runnable[],                 // each runs concurrently (own git worktree)
  merge: MergeFn,                    // how to combine branch outputs
  gate?: Gate,
  onFail?: OnFail,
  transform?: Transform,
}
```

### `Pool` — same step × N

```ts
{
  kind: "pool",
  step: Runnable,                    // replicated N times
  count: number,
  merge: MergeFn,                    // how to combine branch outputs
  gate?: Gate,
  onFail?: OnFail,
  transform?: Transform,
}
```

### `MergeFn` — combining parallel/pool outputs

`MergeFn` is a plain function: `(outputs: string[], ctx: MergeCtx) => string | Promise<string>`.

Import named presets from `merge.js`:

```ts
import { concat, awaitAll, firstPass, vote, rank } from "<captain>/merge.js";
```

| Preset | Behaviour |
|--------|-----------|
| `concat` | Concatenate all outputs in order |
| `awaitAll` | Wait for all, return concatenated (alias for `concat`) |
| `firstPass` | Return the first non-empty output |
| `vote` | LLM picks the single best output |
| `rank` | LLM ranks all outputs and synthesizes the top one |

You can also write inline merge functions:

```ts
merge: (outputs) => outputs.join("\n---\n")
```

---

## Complete Pipeline Example (TypeScript)

```ts
// research-and-build.ts
import { retry, skip, warn } from "<captain>/gates/on-fail.js";
import { bunTest, allOf, outputMinLength, user } from "<captain>/gates/presets.js";
import { llmFast } from "<captain>/gates/llm.js";
import { concat } from "<captain>/merge.js";
import { full, summarize } from "<captain>/transforms/presets.js";
import type { Runnable } from "<captain>/types.js";

export const pipeline: Runnable = {
  kind: "sequential",
  steps: [
    {
      kind: "step",
      label: "Explore codebase",
      model: "flash",
      tools: ["read", "bash"],
      prompt: "Explore the codebase and understand how to implement: $ORIGINAL. Identify relevant files, patterns, and constraints.",
      gate: outputMinLength(100),
      onFail: skip,
      transform: full,
    },
    {
      kind: "parallel",
      steps: [
        {
          kind: "step",
          label: "Write tests",
          model: "sonnet",
          tools: ["read", "bash", "edit", "write"],
          temperature: 0.2,
          prompt: "Based on this analysis:\n$INPUT\n\nWrite failing tests for: $ORIGINAL",
          gate: async ({ ctx }) => {
            const { code } = await ctx!.exec("bash", ["-c", "bun test 2>&1 | grep -q fail"]);
            return code === 0 ? true : "Tests should fail (red phase)";
          },
          onFail: retry(2),
          transform: full,
        },
        {
          kind: "step",
          label: "Write docs",
          model: "sonnet",
          tools: ["read", "bash", "edit", "write"],
          prompt: "Based on this analysis:\n$INPUT\n\nDraft documentation for: $ORIGINAL",
          onFail: warn,
          transform: full,
        },
      ],
      merge: concat,
    },
    {
      kind: "step",
      label: "Implement",
      model: "sonnet",
      tools: ["read", "bash", "edit", "write"],
      temperature: 0.2,
      prompt: "Context:\n$INPUT\n\nImplement: $ORIGINAL\nMake all tests pass.",
      gate: bunTest,
      onFail: retry(3),
      transform: full,
    },
    {
      kind: "step",
      label: "Review",
      model: "flash",
      tools: ["read", "bash"],
      temperature: 0.3,
      prompt: "Review the implementation for $ORIGINAL. Focus on correctness, security, and maintainability.",
      gate: llmFast("Does the review indicate the implementation is ready for production?", 0.8),
      onFail: retry(1),
      transform: summarize(),
    },
  ],
};
```

---

## Quick Start

```
# Load and run a builtin preset
> Use captain to review my PR

# Load a custom TypeScript pipeline
> captain_load: name="./my-pipeline.ts"
> captain_run: name="my-pipeline", input="refactor the auth module"

# Generate a custom pipeline on the fly
> captain_generate: goal="research and document best practices for auth"

# Single-step ad-hoc via /captain-step
> /captain-step "analyze this codebase" --model flash --tools read,bash
```

---

## Development

```bash
git clone https://github.com/Pierre-Mike/pi-captain.git
cd pi-captain
npm install
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run check` | Lint & format check |
| `npm run fix` | Auto-fix lint & format issues |
| `npm test` | Run all tests |

## License

MIT
