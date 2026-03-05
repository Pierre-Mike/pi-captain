# pi-captain

Multi-agent pipeline orchestrator for [pi](https://github.com/badlogic/pi-mono). Define specialized agents, wire them into sequential/parallel/pool pipelines with quality gates, and run complex workflows.

## Install

```bash
# Project-local (recommended — auto-installs for teammates)
pi install -l git:github.com/YOUR-ORG/pi-captain

# Global
pi install git:github.com/YOUR-ORG/pi-captain
```

## What You Get

### Tools

| Tool | Description |
|------|-------------|
| `captain_agent` | Define a reusable agent with name, description, tools, model, and temperature |
| `captain_define` | Wire agents into a pipeline (sequential / parallel / pool) |
| `captain_run` | Execute a pipeline with input, gates enforce quality |
| `captain_status` | Check pipeline progress and results |
| `captain_list` | List all defined pipelines |
| `captain_load` | Load a builtin pipeline preset |
| `captain_generate` | Auto-generate a pipeline from a goal description |

### Builtin Pipeline Presets

| Preset | Description |
|--------|-------------|
| `pr-review` | Parallel security + performance + quality review |
| `full-feature-build` | Architecture → parallel frontend/backend/tests → review |
| `bug-hunt` | Reproduce → diagnose → fix → verify |
| `refactor-and-verify` | Iterative simplification with test gates |
| `research-and-summarize` | Multi-angle research + synthesis |
| `security-audit` | OWASP, secrets, dependencies, red-team assessment |
| `test-coverage-boost` | Find gaps, generate unit + edge-case tests |
| `documentation-gen` | Auto-generate architecture, API, and usage docs |
| `api-design` | Design + implement APIs |
| `migration-planner` | Plan complex migrations with risk assessment |
| `shrinker` | Reduce code size iteratively |
| `gated-feature-build` | Feature build with quality gates |

### Pipeline Composition

```
sequential  — A then B then C
parallel    — A + B + C simultaneously, merge results
pool        — Run same step N times, pick best
```

**Merge strategies:** `concat` | `rank` | `vote` | `firstPass` | `awaitAll`

**Gate types:** `command` (run tests) | `llm` (AI judges quality) | `assert` | `user` | `file` | `none`

**Failure handling:** `retry` (with max attempts) | `skip` | `fallback`

## Quick Start

```
# Load and run a builtin preset
> Use captain to review my PR

# Generate a custom pipeline on the fly
> Use captain to refactor the auth module and ensure all tests pass

# Define a custom pipeline step by step
> Define a captain pipeline that lints, tests, and deploys
```

## Development

```bash
# Clone and develop locally
git clone git:github.com/YOUR-ORG/pi-captain
cd pi-captain
npm install          # installs deps + sets up Husky git hooks via `prepare`

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

Git hooks are managed by [Husky](https://typicode.github.io/husky/) and run automatically after `npm install`.

| Hook | What runs | Purpose |
|------|-----------|---------|
| **pre-commit** | `lint-staged` → `biome check --write` on staged `*.{ts,js,json}` | Auto-fix and gate staged files before commit |
| **pre-push** | `npm run check` | Full lint & format check on the entire codebase before push |

## License

MIT
