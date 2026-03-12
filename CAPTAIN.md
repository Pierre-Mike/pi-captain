# 🚢 Captain — Pipeline Orchestration for pi

> Wire LLM steps into sequential, parallel, and pooled pipelines — with quality gates, failure handling, and intelligent merge strategies. Each step declares its own model, tools, and temperature inline. No separate agent setup required.

---

## Table of Contents

- [What is Captain?](#what-is-captain)
- [Installation](#installation)
- [Tools at a Glance](#tools-at-a-glance)
- [Builtin Pipeline Presets](#builtin-pipeline-presets)
- [Core Concepts](#core-concepts)
  - [Runnable](#runnable)
  - [Step](#step--atomic-llm-invocation)
  - [Composition Patterns](#composition-patterns)
  - [Gates](#gates--validation)
  - [Failure Handling](#failure-handling)
  - [Transforms](#transforms)
  - [Merge Strategies](#merge-strategies)
  - [Prompt Variables](#prompt-variables)
- [Writing Pipelines in TypeScript](#writing-pipelines-in-typescript)
- [Slash Commands](#slash-commands)
- [Real-World Pipeline Examples](#real-world-pipeline-examples)
  - [Research & Build](#1-research--build-pipeline)
  - [GitHub PR Review](#2-github-pr-review)
  - [Research Swarm](#3-research-swarm)
  - [Spec-Driven TDD](#4-spec-driven-tdd)
- [Architecture Overview](#architecture-overview)

---

## What is Captain?

Captain turns **pi** into a full pipeline orchestration platform. It lets you compose LLM agents into typed workflows where:

- **Each step** declares its own model, tool permissions, temperature, and system prompt
- **Gates** validate step output before continuing — using shell commands, regex, file checks, LLM evaluation, or human approval
- **Failure handlers** retry, skip, warn, or fall back to alternative steps automatically
- **Parallel branches** run in isolated git worktrees so agents can write code concurrently without conflicts
- **Pool patterns** replicate the same step N times and merge results democratically (vote, rank, first-pass)
- **Transforms** shape what each step passes to the next — summarize, extract JSON keys, or pass verbatim

Pipelines are **plain TypeScript files** — gates and handlers are real functions, not JSON strings. Full type-safety, IDE autocomplete, and composability.

---

## Installation

```bash
# Project-local (recommended — installs for the whole team)
pi install -l git:github.com/Pierre-Mike/pi-captain

# Global install
pi install git:github.com/Pierre-Mike/pi-captain
```

---

## Tools at a Glance

| Tool | Description |
|------|-------------|
| `captain_load` | Load a pipeline from a builtin preset or a `.ts` file |
| `captain_run` | Execute a pipeline with an input string |
| `captain_status` | View step-by-step results, tokens, cost, and gate outcomes |
| `captain_list` | List all currently defined pipelines |
| `captain_define` | Define a pipeline from a raw JSON spec |
| `captain_generate` | Generate a new `.ts` pipeline file using LLM from a goal description |
| `captain_validate` | Validate a pipeline spec for structural correctness |

---

## Builtin Pipeline Presets

Load any preset with `captain_load { action: "load", name: "captain:<preset>" }`.

| Preset | Description |
|--------|-------------|
| `captain:showcase` | Self-contained demo exercising every feature (gates, retries, pool, parallel, fallback, LLM gate, tool use, JSON extract) |
| `captain:github-pr-review` | End-to-end automated PR review — fetches diffs, runs parallel per-file review, synthesizes APPROVE / REQUEST_CHANGES verdict, posts to GitHub |
| `captain:research-swarm` | 5 parallel researchers + 5 democratic voters + synthesis — deep multi-angle research with deduplication |
| `captain:req-decompose` | Requirements decomposition into EARS statements → user stories → BDD scenarios → typed contracts |
| `captain:req-decompose-ai` | AI-powered variant of req-decompose with LLM scoring and topo-sorted execution spec |
| `captain:requirements-gathering` | Interactive requirements gathering workflow |
| `captain:spec-tdd` | Specification-driven TDD: write spec → generate failing tests → implement → verify |
| `captain:shredder` | Document shredding and structured analysis |

---

## Core Concepts

### Runnable

Everything in Captain is a `Runnable`. The four variants are **infinitely nestable**:

```
Runnable = Step | Sequential | Parallel | Pool
```

---

### Step — Atomic LLM Invocation

A step is a single LLM session. Every configuration is declared inline:

```ts
{
  kind: "step",
  label: "Build & Test",           // shown in UI
  model: "sonnet",                 // "sonnet" | "flash" | any model id
  tools: ["read", "bash", "edit", "write"],
  temperature: 0.2,
  systemPrompt: "You are a strict TDD engineer.",
  skills: ["/path/to/skill.md"],   // inject skill context
  extensions: ["/path/to/ext.ts"], // load extra extensions
  jsonOutput: true,                // request structured JSON output

  prompt: "Implement $ORIGINAL using this analysis:\n$INPUT",

  gate: bunTest,                   // validate output — runs `bun test`
  onFail: retry(3),                // retry up to 3 times on gate fail
  transform: full,                 // pass entire output to next step
}
```

**Step field reference:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kind` | `"step"` | ✅ | Literal type discriminant |
| `label` | string | ✅ | Human-readable name displayed in UI |
| `prompt` | string | ✅ | LLM instructions. Supports `$INPUT` and `$ORIGINAL` |
| `model` | string | — | Model to use (default: session model) |
| `tools` | string[] | — | Allowed tools. Default: `["read","bash","edit","write"]` |
| `temperature` | number | — | Sampling temperature 0–1 |
| `systemPrompt` | string | — | System prompt for the session |
| `skills` | string[] | — | Paths to `.md` skill files to inject |
| `extensions` | string[] | — | Paths to `.ts` extension files to load |
| `jsonOutput` | boolean | — | Ask step to return structured JSON |
| `description` | string | — | Longer documentation string |
| `gate` | Gate | — | Validation function after step runs |
| `onFail` | OnFail | — | What to do when gate fails |
| `transform` | Transform | ✅ | How to pass output to next step |

---

### Composition Patterns

#### Sequential — chain steps via `$INPUT`

Each step receives the previous step's output as `$INPUT`. The simplest and most common pattern.

```ts
export const pipeline: Runnable = {
  kind: "sequential",
  steps: [
    exploreStep,      // 1️⃣ understand codebase
    implementStep,    // 2️⃣ receives explore output as $INPUT
    reviewStep,       // 3️⃣ receives implement output as $INPUT
  ],
};
```

```
User Input ──► Step A ──► Step B ──► Step C ──► Final Output
                 $INPUT      $INPUT
```

---

#### Parallel — different steps concurrently

Multiple **different** steps run simultaneously, each in its own isolated git worktree. Results are merged.

```ts
export const pipeline: Runnable = {
  kind: "parallel",
  steps: [
    { kind: "step", label: "Write Tests", ... },
    { kind: "step", label: "Write Docs", ... },
    { kind: "step", label: "Security Audit", ... },
  ],
  merge: concat,   // combine all outputs
};
```

```
                 ┌──► Write Tests ──────┐
User Input ─────┼──► Write Docs ───────┼──► merge ──► Next Step
                 └──► Security Audit ──┘
```

> Each parallel branch runs in its own **git worktree** — agents can write files concurrently without conflicts.

---

#### Pool — same step × N

The **same** step is replicated N times with the same input. Useful for getting multiple independent opinions and merging democratically.

```ts
export const pipeline: Runnable = {
  kind: "pool",
  step: { kind: "step", label: "Solve", prompt: "Solve: $INPUT", ... },
  count: 5,
  merge: vote,    // LLM picks the best output
};
```

```
              ┌──► Solve (copy 1) ──┐
              ├──► Solve (copy 2) ──┤
Input ────────┼──► Solve (copy 3) ──┼──► vote/rank/concat ──► Winner
              ├──► Solve (copy 4) ──┤
              └──► Solve (copy 5) ──┘
```

---

### Gates — Validation

A gate is a **plain function** that validates step output before the pipeline continues:

```ts
type Gate = (params: { output: string; ctx?: GateCtx }) => true | string | Promise<true | string>
```

- Return `true` → **pass**, move on
- Return a `string` → **fail**, string is the reason
- `throw` → treated as a failure

#### Inline gates

```ts
// Content check
gate: ({ output }) => output.includes("DONE") ? true : 'Output must contain "DONE"'

// JSON validity
gate: ({ output }) => {
  try { JSON.parse(output.trim()); return true; }
  catch { return "Output is not valid JSON"; }
}

// Shell command
gate: async ({ ctx }) => {
  const { code, stderr } = await ctx!.exec("bash", ["-c", "bun test"]);
  return code === 0 ? true : `Tests failed: ${stderr.slice(0, 200)}`;
}

// Stateful gate with closure
let attempts = 0;
gate: ({ output }) => {
  attempts++;
  return attempts >= 3 ? true : `Need 3 attempts, got ${attempts}`;
}
```

#### Gate presets

Import from `"./captain"` (the barrel export):

| Preset | Behavior |
|--------|----------|
| `bunTest` | Runs `bun test` — passes on exit 0 |
| `command("npm test")` | Runs any shell command — passes on exit 0 |
| `file("dist/index.js")` | File must exist at the given path |
| `regexCI("^ok")` | Output must match regex (case-insensitive) |
| `allOf(gate1, gate2)` | All provided gates must pass |
| `user` | Human must approve in the interactive UI |
| `llmFast("Is this correct?", 0.8)` | LLM evaluates quality with a threshold (0–1) |

```ts
import { bunTest, command, file, regexCI, allOf, user, llmFast } from "./captain";

// Combined gate: tests pass AND output reviewed by LLM
gate: allOf(
  bunTest,
  llmFast("Is the implementation production-ready?", 0.8)
)
```

---

### Failure Handling

An `OnFail` is a **plain function** invoked when a gate fails:

```ts
type OnFail = (ctx: OnFailCtx) => OnFailResult | Promise<OnFailResult>

interface OnFailCtx {
  reason: string;       // why the gate failed
  retryCount: number;   // retries already attempted
  stepCount: number;    // total times step has run
  output: string;       // last output before failure
}
```

#### OnFail presets

| Preset | Behavior |
|--------|----------|
| `retry(3)` | Re-run the step up to 3 times, then fail |
| `retryWithDelay(3, 2000)` | Retry up to 3 times, waiting 2 seconds between attempts |
| `skip` | Discard output, continue pipeline with empty string |
| `warn` | Log a warning, treat as passed, continue with current output |
| `fallback(alternativeStep)` | Run a different step instead |

#### Custom inline handler

```ts
// Retry twice, then warn and continue
onFail: ({ retryCount }) => retryCount < 2
  ? { action: "retry" }
  : { action: "warn" }
```

> **`warn` vs `skip`:**
> - **`warn`** — gate failed but output is still useful. Pass it through with a warning.
> - **`skip`** — gate failed and output should be discarded. Continue with empty string.

---

### Transforms

A transform shapes what gets passed to the next step:

```ts
type Transform = (params: {
  output: string;    // raw step output
  original: string;  // the first user input ($ORIGINAL)
  ctx: TransformCtx;
}) => string | Promise<string>
```

#### Transform presets

| Preset | Behavior |
|--------|----------|
| `full` | Pass entire output unchanged (most common) |
| `extract("key")` | Parse JSON output and extract a top-level key |
| `summarize()` | Ask LLM to condense output to 2–3 sentences |

#### Inline transforms

```ts
// Trim whitespace
transform: ({ output }) => output.trim()

// Extract from JSON with fallback
transform: ({ output }) => {
  try { return JSON.parse(output).result; }
  catch { return output; }
}

// Post-process via shell
transform: async ({ output, ctx }) => {
  const { stdout } = await ctx.exec("jq", ["-r", ".items[]"]);
  return stdout || output;
}
```

---

### Merge Strategies

Used by `parallel` and `pool` to combine multiple branch outputs.

```ts
type MergeFn = (outputs: string[], ctx: MergeCtx) => string | Promise<string>
```

| Preset | Behavior |
|--------|----------|
| `concat` | Join all outputs in order with separators |
| `awaitAll` | Wait for all branches, then concatenate (alias for `concat`) |
| `firstPass` | Return the first non-empty output |
| `vote` | LLM picks the single best output from all branches |
| `rank` | LLM ranks all outputs and synthesizes the top-ranked one |

```ts
// Inline merge
merge: (outputs) => outputs.join("\n---\n")
```

---

### Prompt Variables

| Variable | Value |
|----------|-------|
| `$INPUT` | Output of the previous step (or user's original input on step 1) |
| `$ORIGINAL` | The user's original request — preserved unchanged throughout the entire pipeline |

---

## Writing Pipelines in TypeScript

Pipelines are `.ts` files that export a `pipeline` const of type `Runnable`.

### File convention

User pipelines live in `.pi/pipelines/`. Start every file with two header comments for auto-discovery:

```ts
// @name: my-pipeline-name
// @description: One-line description of what this pipeline does
```

### Barrel imports

Import everything from `"./captain"` — it re-exports all types and presets:

```ts
import {
  // Gates
  bunTest, command, file, regexCI, allOf, user, llmFast,
  // OnFail
  retry, retryWithDelay, fallback, skip, warn,
  // Transforms
  full, extract, summarize,
  // Merge
  concat, awaitAll, firstPass, vote, rank,
  // Types
  type Runnable, type Step, type Gate, type OnFail, type Transform,
} from "./captain";
```

> ⚠️ Always use `"./captain"` — never hardcoded absolute paths.

### Quick start

```ts
// .pi/pipelines/my-pipeline.ts
// @name: my-pipeline
// @description: Research a topic, implement code, get it reviewed

import { retry, skip, bunTest, user, full, summarize } from "./captain";
import type { Runnable } from "./captain";

export const pipeline: Runnable = {
  kind: "sequential",
  steps: [
    {
      kind: "step",
      label: "Research",
      model: "sonnet",
      tools: ["read", "bash"],
      prompt: "Research the following topic thoroughly:\n$ORIGINAL",
      onFail: skip,
      transform: full,
    },
    {
      kind: "step",
      label: "Implement",
      model: "sonnet",
      tools: ["read", "bash", "edit", "write"],
      prompt: "Based on this research:\n$INPUT\n\nImplement: $ORIGINAL",
      gate: bunTest,
      onFail: retry(3),
      transform: full,
    },
    {
      kind: "step",
      label: "Review",
      model: "flash",
      temperature: 0.3,
      prompt: "Review this implementation:\n$INPUT\n\nOriginal request: $ORIGINAL",
      gate: user,
      onFail: skip,
      transform: summarize(),
    },
  ],
};
```

Load and run:
```
captain_load { action: "load", name: "./.pi/pipelines/my-pipeline.ts" }
captain_run  { name: "my-pipeline", input: "Build a REST API for user management" }
```

Or use `captain_generate` to generate a pipeline from a goal description:
```
captain_generate { goal: "review this PR for security vulnerabilities and code quality" }
```

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/captain` | Interactive pipeline launcher or show pipeline details |
| `/captain-load [name]` | List available presets (no args) or load a specific preset |
| `/captain-run <name> <input>` | Quick-run a pipeline. Supports `--step <label>` to run a single step |
| `/captain-generate <goal>` | Generate a new pipeline file using LLM |
| `/captain-step <prompt> [flags]` | Run an ad-hoc step with `--model`, `--tools`, `--label` flags |
| `/captain-help` | Show all commands and usage |

---

## Real-World Pipeline Examples

### 1. Research & Build Pipeline

A full sequential flow: explore → write tests (parallel with docs) → implement → LLM-gated review.

```
User Input
    │
    ▼
┌──────────────┐
│ Explore      │  model: flash  tools: [read, bash]
│ Codebase     │  understand architecture, patterns, constraints
└──────┬───────┘
       │ $INPUT
       ▼
┌──────────────────────────────────────────────┐
│               PARALLEL                        │
│  ┌──────────────┐   ┌──────────────────────┐ │
│  │ Write Tests  │   │ Write Documentation  │ │
│  │ model:sonnet │   │ model:sonnet         │ │
│  │ gate: red ✓  │   │ onFail: warn         │ │
│  └──────────────┘   └──────────────────────┘ │
│                   merge: concat               │
└──────────────────────┬───────────────────────┘
                       │ $INPUT
                       ▼
              ┌──────────────┐
              │  Implement   │  model: sonnet  gate: bunTest  retry(3)
              └──────┬───────┘
                     │ $INPUT
                     ▼
              ┌──────────────┐
              │   Review     │  model: flash  gate: llmFast(0.8)
              └──────────────┘
```

### 2. GitHub PR Review

A production-grade 7-stage pipeline that reviews pull requests end-to-end.

```
owner/repo#42
    │
    ▼  1️⃣  PARSE       Parse 'owner/repo#N' → typed PrReference
    │
    ▼  2️⃣  VALIDATE    [parallel] input rejection tests + GITHUB_TOKEN check
    │
    ▼  3️⃣  FETCH META  [parallel] GET /pulls/{n} + auth-failure path
    │
    ▼  4️⃣  EMIT META   raw API JSON → typed PrMetadata
    │
    ▼  5️⃣  FILES       gh pr diff → structured file list
    │
    ▼  6️⃣  REVIEW      [pool ×10] per-file review in parallel
    │                  (correctness · security · quality · types · tests)
    │
    ▼  7️⃣  VERDICT     aggregate findings → APPROVE / REQUEST_CHANGES / COMMENT
                       → posts review to GitHub via CLI
```

Load with:
```
captain_load { action: "load", name: "captain:github-pr-review" }
captain_run  { name: "github-pr-review", input: "myorg/myrepo#123" }
```

### 3. Research Swarm

5 independent researchers explore a question from different angles simultaneously, then vote democratically on the best findings.

```
"What are the best practices for auth in 2025?"
    │
    ▼  1️⃣  PLAN         Decompose question into 5 distinct research angles
    │
    ▼  2️⃣  RESEARCH     [parallel ×5] each researcher explores one angle
    │                   with web search + codebase tools
    │
    ▼  3️⃣  CONSOLIDATE  Deduplicate findings, assign numbers 1..N
    │
    ▼  4️⃣  VOTE         [parallel ×5] each voter scores all findings 1–10
    │
    ▼  5️⃣  SYNTHESIZE   Tally scores → final synthesis of top-ranked findings
```

### 4. Spec-Driven TDD

Write a spec, generate failing tests, implement to make them pass — all automated.

```
Feature Request
    │
    ▼  SPEC    Write formal specification from feature request
    │
    ▼  RED     Write failing tests matching the spec (gate: tests must FAIL)
    │
    ▼  GREEN   Implement until all tests pass     (gate: bunTest → retry 3×)
    │
    ▼  REFACTOR Clean up, document, verify tests still pass
```

---

## Architecture Overview

```
captain/
├── types.ts              ← Runnable, Step, Sequential, Parallel, Pool, Gate, OnFail, Transform
├── index.public.ts       ← Barrel re-export (import everything from "./captain")
│
├── core/
│   ├── runner.ts         ← Pipeline executor (sequential/parallel/pool dispatch)
│   ├── merge.ts          ← concat, awaitAll, firstPass, vote, rank
│   └── worktree.ts       ← Git worktree isolation for parallel/pool branches
│
├── gates/
│   ├── presets.ts        ← bunTest, command, file, regexCI, allOf, user
│   ├── llm.ts            ← llmFast (LLM quality evaluator)
│   └── on-fail.ts        ← retry, retryWithDelay, fallback, skip, warn
│
├── transforms/
│   └── presets.ts        ← full, extract, summarize
│
├── tools/                ← captain_load, captain_run, captain_status, captain_list,
│   │                        captain_define, captain_generate, captain_validate
│
└── steps/                ← Pre-built step library (fetch-pr-*, review-pr-*, tdd-*, …)
```

**Key runtime behaviors:**
- **Git worktrees**: Each `parallel` branch and each `pool` replica runs in an isolated git worktree — no file conflicts, full isolation
- **Token tracking**: `captain_status` reports token usage and cost per step
- **Gate retry loop**: When a gate fails, `onFail` decides: retry sends the step back through with the failure reason appended to context
- **$ORIGINAL preservation**: No matter how many steps deep, `$ORIGINAL` always holds the user's first input

---

## Summary

| Capability | What it gives you |
|------------|-------------------|
| **Sequential** | Chain steps with automatic input passing via `$INPUT` |
| **Parallel** | Run different agents simultaneously in isolated worktrees |
| **Pool** | Get N independent answers, then vote or rank the best one |
| **Gates** | Shell, regex, file, LLM, or human validation after every step |
| **Failure handling** | Retry, delay, skip, warn, or fall back to alternative steps |
| **Transforms** | Summarize, extract JSON keys, or pass raw output |
| **Merge strategies** | Concat, first-pass, vote, or LLM-ranked synthesis |
| **TypeScript-native** | Real functions — type-safe, composable, IDE-friendly |
| **Builtin presets** | 8 production-grade pipelines ready to load and run |
| **LLM generation** | Describe a goal → `captain_generate` writes the pipeline for you |

---

*Part of [pi](https://github.com/badlogic/pi-mono) — the coding agent harness.*
