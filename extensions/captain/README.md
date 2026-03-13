# 🧑‍✈️ Captain

Multi-step pipeline orchestrator for pi. Define sequential and parallel pipelines in TypeScript, wire quality gates between steps, and run complex multi-agent workflows — each step declares its own model, tools, system prompt, and temperature inline.

## Install

```bash
pi install npm:pi-captain
```

## What it does

Registers seven tools (`captain_run`, `captain_status`, `captain_list`, `captain_kill`, `captain_load`, `captain_generate`, `captain_validate`) and several slash commands. You describe a pipeline goal, Captain generates or loads a typed TypeScript pipeline spec, and then executes it — chaining `$INPUT`/`$ORIGINAL` through prompts, evaluating gates, and handling failures.

## Tools

| Tool | Description |
|---|---|
| `captain_generate` | Generate a `.ts` pipeline file on-the-fly from a natural language goal |
| `captain_load` | Load a pipeline from a `.ts` file or builtin preset |
| `captain_run` | Execute a loaded pipeline with an input string |
| `captain_status` | Check the status of a running or completed pipeline |
| `captain_list` | List all defined pipelines |
| `captain_kill` | Kill a running pipeline job by ID |
| `captain_validate` | Validate a pipeline spec for structural correctness |

## Pipeline kinds

| Kind | Description |
|---|---|
| `sequential` | Steps run one after another; output of each becomes input of the next |
| `parallel` | Steps run concurrently; outputs are merged via a `merge` function |
| `prompt` | A single LLM prompt step |

## Quality gates

Each step can declare a `gate` — a condition evaluated on the step's output before continuing. Built-in presets (from `./captain.ts`): `nonempty`, `json`, `contains`, `llmScore`. On failure, the pipeline can `retry`, `skip`, `abort`, or run an `onFail` branch.

## Commands

| Command | Description |
|---|---|
| `/captain [name] [input]` | Run a pipeline by name/path, or list pipelines when called with no args |
| `/captain-generate <goal>` | Generate a new pipeline from a natural language goal |
| `/captain-step <prompt>` | Run an ad-hoc single step (`--model`, `--tools`, `--label` flags) |
| `/captain-kill <id>` | Kill a running pipeline job by ID |
| `/captain-jobs` | List all pipeline jobs and their statuses |
| `/captain-help` | Show all captain commands |

## Pipeline files

Pipelines are `.ts` files stored in `.pi/pipelines/`. Import all types and presets from the barrel:

```typescript
import type { Runnable } from "./captain.js";
import { nonempty, llmScore } from "./captain.js";
```

## Bundled skill

The extension ships with a `skills/captain/SKILL.md` that is automatically available in the session. It guides the LLM on pipeline authoring, step composition, gate usage, and merge strategies.

## Example

```typescript
import type { Runnable } from "./captain.js";
import { nonempty } from "./captain.js";

export const pipeline: Runnable = {
  kind: "sequential",
  steps: [
    {
      kind: "prompt",
      model: { provider: "anthropic", id: "claude-sonnet-4-5" },
      prompt: "Research this topic: $INPUT",
    },
    {
      kind: "prompt",
      model: { provider: "anthropic", id: "claude-sonnet-4-5" },
      prompt: "Summarise the research into bullet points: $INPUT",
      gate: nonempty(),
    },
  ],
};
```

## Parallel example

```typescript
import type { Runnable } from "./captain.js";
import { joinSections } from "./captain.js";

export const pipeline: Runnable = {
  kind: "parallel",
  merge: joinSections("---"),
  steps: [
    {
      kind: "prompt",
      model: { provider: "anthropic", id: "claude-haiku-4-5" },
      label: "Security review",
      prompt: "Review for security issues: $INPUT",
    },
    {
      kind: "prompt",
      model: { provider: "anthropic", id: "claude-haiku-4-5" },
      label: "Quality review",
      prompt: "Review for code quality: $INPUT",
    },
  ],
};
```
