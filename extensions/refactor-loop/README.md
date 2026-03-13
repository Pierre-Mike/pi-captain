# ♻️ Refactor Loop

Iterative refactoring pipeline for pi. Runs `analyze → refactor → verify` cycles with a TUI progress widget, optional git commit-and-push per completion, and a bundled skill that guides the model through each pass.

## Install

```bash
pi install npm:pi-refactor-loop
```

## What it does

Registers a `/refactor` command that walks you through a setup dialog, then drives the agent through up to N simplification passes on a target (file, function, module, etc.). Each pass the agent:

1. Analyses the target and identifies one focused simplification
2. Applies the change
3. Runs your test command (if provided)
4. Calls the `refactor_pass` tool to report results and continue

The loop stops when the agent declares the code clean (`done: true`) or the pass limit is reached.

## Commands

| Command | Description |
|---|---|
| `/refactor [target]` | Start a refactoring pipeline. Prompts for target, test command, pass limit, and auto-commit if no args given |
| `/refactor-stop` | Stop the active pipeline immediately |

## Setup dialog

On `/refactor`, you are prompted for:

| Prompt | Description |
|---|---|
| Target | File path, function name, or module to refactor |
| Test command | Shell command to run after each pass (e.g. `bun test`, `pytest`) — leave empty to skip |
| Max passes | 3 / 5 / 10 / 20 |
| Auto commit & push | Automatically `git commit` and `git push` when the pipeline completes |

## Tool: `refactor_pass`

The agent calls this after each pass to report what changed.

| Parameter | Type | Description |
|---|---|---|
| `change` | `string` | What was changed in this pass |
| `reason` | `string` | Why this simplification improves the code |
| `remaining` | `string` | What simplification opportunities remain (empty if done) |
| `done` | `boolean` | `true` if the code is clean and no more passes are needed |

## Bundled skill

The extension ships with a `SKILL.md` that is automatically loaded into the session. It provides detailed instructions on the analyze → refactor → verify cycle, what counts as a good simplification, and when to stop.

## TUI widget

While the pipeline is active, a widget shows the current pass, target, and completed changes.
