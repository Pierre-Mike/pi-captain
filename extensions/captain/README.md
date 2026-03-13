# 🧑‍✈️ Captain

Multi-step pipeline orchestrator for pi. Define sequential, parallel, and pool pipelines in TypeScript, wire quality gates between steps, and run complex multi-agent workflows — each step declares its own model, tools, system prompt, and temperature inline.

## Install

```bash
pi install npm:pi-captain
```

## What it does

Registers four tools (`captain_generate`, `captain_load`, `captain_run`, `captain_status`) and several commands. You describe a pipeline goal, Captain generates or loads a typed TypeScript pipeline spec, and then executes it — managing git worktrees for isolation, chaining `$INPUT`/`$ORIGINAL` through prompts, evaluating gates, and handling failures.

## Tools

| Tool | Description |
|---|---|
| `captain_generate` | Generate a `.ts` pipeline file on-the-fly from a natural language goal |
| `captain_load` | Load a pipeline from a `.ts` file or builtin preset |
| `captain_run` | Execute a loaded pipeline with an input string |
| `captain_status` | Check the status of a running or completed pipeline |
| `captain_list` | List all defined pipelines |
| `captain_validate` | Validate a pipeline spec for structural correctness |

## Pipeline kinds

| Kind | Description |
|---|---|
| `sequential` | Steps run one after another; output of each becomes input of the next |
| `parallel` | Steps run concurrently; outputs are merged |
| `pool` | A list of inputs processed concurrently by the same step |
| `prompt` | A single LLM prompt step |

## Quality gates

Each step can declare a `gate` — a condition evaluated on the step's output before continuing. Built-in presets: `nonempty`, `json`, `contains`, `llm-score`. On failure, the pipeline can `retry`, `skip`, `abort`, or run an `onFail` branch.

## Commands

| Command | Description |
|---|---|
| `/captain generate <goal>` | Generate a new pipeline |
| `/captain load <name>` | Load a pipeline by name or file path |
| `/captain run [input]` | Run the loaded pipeline |
| `/captain status` | Show the last run's step-by-step results |
| `/captain list` | List available pipelines |

## Bundled skill

The extension ships with a `skills/captain/SKILL.md` that is automatically available in the session. It guides the LLM on pipeline authoring, step composition, gate usage, and merge strategies.

## Example

```typescript
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
      gate: { preset: "nonempty" },
    },
  ],
};
```
