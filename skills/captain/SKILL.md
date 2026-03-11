---
name: captain
description: >
  Orchestrate multi-step workflows using Captain pipelines. Each step declares
  its own model, tools, and temperature inline — no separate agent setup needed.
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
| `captain_load` | Load a pipeline from a `.ts` file or builtin preset |
| `captain_run` | Execute a defined pipeline with input |
| `captain_status` | Check step-by-step results of a pipeline |
| `captain_list` | List all defined pipelines |

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
import { retry, skip, warn } from "<captain>/gates/on-fail.js";
import { bunTest, command, regexCI, user } from "<captain>/gates/presets.js";
import { llmFast } from "<captain>/gates/llm.js";
import { full, summarize } from "<captain>/transforms/presets.js";
import type { Gate, OnFail, Runnable, Step } from "<captain>/types.js";

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
  temperature: 0.3,
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

### 2. Load and run it

```
captain_load: action="load", name="./my-pipeline.ts"
captain_run: name="my-pipeline", input="Build a REST API for user management"
```

## Step Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `label` | string | required | Display name shown in UI |
| `prompt` | string | required | Instructions for the step. Supports `$INPUT`, `$ORIGINAL` |
| `model` | string | session model | e.g. `"sonnet"`, `"flash"` |
| `tools` | string[] | `["read","bash","edit","write"]` | Tool names to enable |
| `temperature` | number | — | Sampling temperature (0–1) |
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
captain_load: action="list"
captain_load: action="load", name="captain:showcase"
captain_load: action="load", name="./my-pipeline.ts"
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
import { concat } from "<captain>/merge.js";

export const pipeline: Runnable = {
  kind: "parallel",
  steps: [frontendStep, backendStep],
  merge: concat,
};
```

### Pool — same step × N (each in own git worktree)

```ts
import { vote } from "<captain>/merge.js";

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
import { concat, awaitAll, firstPass, vote, rank } from "<captain>/merge.js";
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

- `/captain` — Interactive pipeline launcher OR show pipeline details
- `/captain-load [name]` — List available presets (no args) or load a specific preset
- `/captain-run <name> <input>` — Quick-run a pipeline (supports `--step <label>` for single step)
- `/captain-generate <goal>` — Generate a new pipeline using LLM
- `/captain-step <prompt> [flags]` — Run ad-hoc step with `--model`, `--tools`, `--label` flags
- `/captain-help` — Show all commands and usage