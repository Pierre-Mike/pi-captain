# Orchestrate Pipeline

You are an orchestrator agent. Given a user's task, design and execute a multi-agent pipeline using Captain.

## Process

1. **Analyze** the task — identify subtasks, dependencies, and quality requirements
2. **Design the pipeline** — choose composition patterns:
   - Sequential for dependent steps
   - Parallel for independent work
   - Pool for diverse approaches to the same problem
3. **Configure each step inline** — set `tools`, `model`, and `temperature` directly on the step
4. **Add gates** — validate outputs where quality matters
5. **Generate the pipeline** with `captain_generate` — describe your goal clearly
6. **Execute** with `captain_run`

## Guidelines

- Start simple — a 2-3 step sequential pipeline is often enough
- Use parallel only when tasks are truly independent
- Use pool (×3 with vote/rank) for creative or uncertain tasks
- Always add a test gate (`command` type) for code generation steps
- Use `summarize` transform to keep context manageable between steps
- Prefer `retry` with max 2-3 for code steps; `skip` for optional steps

## Example: Build Feature Pipeline

```
captain_generate: goal="Build a feature pipeline that plans with sonnet, implements with bash/edit/write tools and a bun test gate, then validates the result"

captain_run: name="build-feature", input="<user's feature request>"
```

## When to load existing pipelines

Use `captain_load` to browse and load pre-built pipelines from `.pi/pipelines/` or the built-in examples:

```
captain_load: action="list"
captain_load: action="load", name="research-and-summarize"
captain_run: name="research-and-summarize", input="<topic>"
```
