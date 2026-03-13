---
name: captain
description: >
  Orchestrate multi-step workflows using Captain pipelines. Each step declares
  its own model and tools inline — no separate agent setup needed.
  Supports sequential, parallel, and pool composition with quality gates,
  failure handling, and merge strategies. Use when building research, code
  generation, review, or any multi-step LLM workflow.
---

# Captain — Pipeline Orchestration

## Overview

Captain turns pi into a pipeline orchestration platform. Define typed pipeline specs with sequential, parallel, and pool composition patterns, then execute them with automatic git worktree isolation, gate validation, failure handling, and merge strategies.

## When to Use

- Multi-step workflows: research → synthesize → review
- Parallel exploration: run the same task N ways and merge results
- Quality gates: validate outputs with shell commands, file checks, or human approval
- Complex code generation: plan → implement → test → fix loops

## Available Tools

| Tool | Purpose |
|------|---------|
| `captain_run` | Execute a named pipeline (already loaded) with input |
| `captain_status` | Check step-by-step results of a pipeline |
| `captain_list` | List all defined pipelines |

> **Prefer `/captain` over raw tool calls.** The `/captain` slash command loads *and* runs a pipeline in one shot, accepts a file path or preset name, and handles both steps automatically.

## Quick Start

### 1. Write a TypeScript pipeline file

Pipelines are **TypeScript files** that export a `pipeline` const of type `Runnable`.
Gates and onFail handlers are **plain functions** — no JSON encoding needed.

> **Convention for user pipelines in `.pi/pipelines/`:** Start the file with these two header comments so the name and description are discoverable without importing the module (required for `captain_generate` output, recommended for all hand-written pipelines):
> ```ts
> // @name: my-pipeline-name
> // @description: One-line description of what this pipeline does
> ```

```ts
// my-pipeline.ts
import { retry, skip, warn, bunTest, command, regexCI, user, llmFast, full, summarize } from "./captain.ts";
import type { Gate, OnFail, Runnable, Step } from "./captain.ts";

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
  gate: bunTest,                // runs `bun test`, passes on exit 0
  onFail: retry(3),
  transform: full,
};

const review: Step = {
  kind: "step",
  label: "Review",
  model: "flash",
  tools: ["read", "bash"],
  prompt: "Review this implementation:\n$INPUT\n\nOriginal: $ORIGINAL",
  gate: user,                   // requires human approval in interactive UI
  onFail: skip,
  transform: summarize(),
};

export const pipeline: Runnable = {
  kind: "sequential",
  steps: [research, implement, review],
};
```

### 2. Run it — one shot

Use the `/captain` slash command — it loads **and** runs in a single step:

```
/captain ./my-pipeline.ts "Build a REST API for user management"
/captain captain:showcase "Research quantum computing"
```

`/captain` accepts:
- A **relative or absolute path** to a `.ts` pipeline file **or step file**
- A **preset name** (e.g. `captain:showcase`, see `/captain-load` for the full list)
- An optional **input string** as the second argument (becomes `$ORIGINAL` and first `$INPUT`)

**Step files work directly** — no need to wrap in a pipeline file. Any `.ts` file that exports a named const with `kind: "step"` (or any other Runnable kind) is accepted:

```ts
// examples/steps/review-code.ts
export const reviewCode: Step = { kind: "step", label: "Review", prompt: "…", … };
```

```
/captain examples/steps/review-code.ts 'this repo'
```

The loader checks for a `pipeline` export first, then falls back to scanning all named exports for any object with `kind` in `"step" | "sequential" | "pool" | "parallel"`.

If you need finer control after a pipeline is already loaded, you can still call `captain_run` directly.

## Import Aliases and Barrel Exports

Captain supports two convenient ways to import presets and types for better IDE support:

### Path Aliases

Use either alias syntax to reference captain extension files:

```ts
// Standard alias with angle brackets (original syntax)
import { retry } from "<captain>/gates/on-fail.js";

// Convenience alias without angle brackets (new syntax)
import { retry } from "captain/gates/on-fail.js";
```

Both aliases resolve to the same absolute path of the captain extension directory.

### Barrel Imports

Import multiple presets from a single file for better autocomplete and fewer import lines:

```ts
// Import all commonly used presets from one barrel file
import { 
  bunTest, retry, full, concat, 
  Runnable, Step, Gate, OnFail 
} from "./captain";
```

> ⚠️ **Always use `"./captain"` — never hardcoded absolute paths.**
> Pipeline files live in `.pi/pipelines/` alongside the `captain` barrel re-export,
> so `"./captain"` always resolves correctly regardless of machine or user.

The barrel export includes:
- **Gate presets**: `command`, `file`, `regexCI`, `allOf`, `user`, `bunTest`
- **OnFail presets**: `retry`, `retryWithDelay`, `fallback`, `skip`, `warn`
- **Transform presets**: `full`, `extract`, `summarize`
- **Merge presets**: `concat`, `awaitAll`, `firstPass`, `vote`, `rank`
- **Core types**: `Runnable`, `Step`, `Sequential`, `Pool`, `Parallel`, `Gate`, `OnFail`, `Transform`, `MergeFn`, `ModelId`

## Step Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | string | required | Display name shown in UI |
| `prompt` | string | required | Instructions for the step. Supports `$INPUT`, `$ORIGINAL` |
| `model` | string | session model | e.g. `"sonnet"`, `"flash"` |
| `tools` | string[] | `["read","bash","edit","write"]` | Tool names to enable |
| `systemPrompt` | string | — | System prompt for the LLM session |
| `skills` | string[] | — | Additional skill file paths to inject |
| `extensions` | string[] | — | Additional extension file paths to load |
| `jsonOutput` | boolean | `false` | Instructs step to produce structured JSON |
| `description` | string | — | Step documentation |
| `gate` | Gate | `undefined` | Validation after step runs (function) |
| `onFail` | OnFail | required | What to do when gate fails (function) |
| `transform` | Transform | required | How to pass output to the next step |

## Gates — Plain Functions

A `Gate` is: `({ output, ctx? }) => true | string | Promise<true | string>`

- Return `true` → gate passed
- Return a `string` → gate failed, string is the reason
- `throw` → gate failed, error message becomes the reason

### Inline gate

```ts
// Simple output check
gate: ({ output }) => output.includes("DONE") ? true : 'Output must contain "DONE"'

// JSON validity check
gate: ({ output }) => {
  try { JSON.parse(output.trim()); return true; }
  catch { return "Output is not valid JSON"; }
}

// Stateful gate using closure (replaces shell temp-file hacks)
let attempts = 0;
gate: ({ output }) => {
  attempts++;
  return attempts >= 3 ? true : `Need 3 attempts, got ${attempts}`;
}
```

### Shell command in gate

```ts
gate: async ({ ctx }) => {
  const { code, stderr } = await ctx!.exec("bash", ["-c", "bun test"]);
  return code === 0 ? true : `Tests failed: ${stderr.slice(0, 200)}`;
}
```

### Gate presets (import from `gates/presets.js`)

| Preset | Behavior |
|--------|----------|
| `bunTest` | Runs `bun test`, passes on exit 0 |
| `command("npm test")` | Runs any shell command |
| `file("dist/index.js")` | File must exist |
| `regexCI("^ok")` | Output must match regex (case-insensitive) |
| `user` | Human must approve in interactive UI |
| `allOf(gate1, gate2)` | All gates must pass |
| `llmFast("Is this correct?", 0.8)` | LLM judges quality (threshold 0–1) |

## Failure Handling — Plain Functions

An `OnFail` is: `(ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>`

### OnFail presets (import from `gates/on-fail.js`)

| Preset | Behavior |
|--------|----------|
| `retry(3)` | Re-run up to 3 times |
| `retryWithDelay(3, 2000)` | Re-run up to 3 times, wait 2s between |
| `skip` | Pass empty string downstream |
| `warn` | Log warning, treat as passed |
| `fallback(myStep)` | Run an alternative step instead |

### Custom onFail

```ts
// Retry twice, then warn
onFail: ({ retryCount }) => retryCount < 2 ? { action: "retry" } : { action: "warn" }
```

## Loading Pipeline Presets

```
/captain-load               # list all available presets
/captain captain:showcase "some input"   # load + run a builtin preset
/captain ./my-pipeline.ts "some input"   # load + run a local pipeline file
```

## Composition Patterns

### Sequential — chain via $INPUT

```ts
export const pipeline: Runnable = {
  kind: "sequential",
  steps: [stepA, stepB, stepC],
};
```

### Parallel — different steps concurrently (each in own git worktree)

```ts
import { concat } from "captain/merge.js"; // using convenience alias

export const pipeline: Runnable = {
  kind: "parallel",
  steps: [frontendStep, backendStep],
  merge: concat,
};
```

### Pool — same step × N (each in own git worktree)

```ts
import { vote } from "./captain.ts";

export const pipeline: Runnable = {
  kind: "pool",
  step: solveStep,
  count: 3,
  merge: vote,
};
```

## Merge Functions

`merge` is a plain function `(outputs: string[], ctx) => string | Promise<string>`.
Import named presets from `merge.js`:

```ts
import { concat, awaitAll, firstPass, vote, rank } from "./captain.ts";
```

| Preset | Behavior |
|--------|----------|
| `concat` | Join all outputs with separators |
| `awaitAll` | Wait for all, concatenate (alias for `concat`) |
| `firstPass` | Take the first non-empty output |
| `vote` | LLM picks the best/most common answer |
| `rank` | LLM ranks outputs and synthesizes the top one |

You can also write inline:
```ts
merge: (outputs) => outputs.join("\n---\n")
```

## Prompt Variables

- `$INPUT` — Output of the previous step (or user input for the first step)
- `$ORIGINAL` — The user's original request (preserved throughout the pipeline)

## Slash Commands

- `/captain <file-or-preset> [input]` — **Primary entry point.** Load *and* run a pipeline **or step** in one shot. Accepts a `.ts` pipeline file, a `.ts` step file (any named export with a valid `kind`), or a preset name, plus an optional input string.
- `/captain-load [name]` — List available presets (no args) or load a specific preset without running it
- `/captain-run <name> <input>` — Run an already-loaded pipeline (supports `--step <label>` for single step)
- `/captain-generate <goal>` — Generate a new pipeline using LLM
- `/captain-step <prompt> [flags]` — Run ad-hoc step with `--model`, `--tools`, `--label` flags
- `/captain-help` — Show all commands and usage