# Feature: Cloud Pipeline Dispatch via Cloudflare Workers + Durable Objects

## Summary

Run captain pipelines on the cloud by dispatching them to a Cloudflare Workers edge service. A Durable Object orchestrates the pipeline state machine, Cloudflare Containers execute individual steps running pi headless, and results stream back to the CLI via SSE.

## Motivation

Captain pipelines can be long-running, CPU/token-intensive, and benefit from parallelism. Running them locally ties up the user's machine and limits fan-out. A cloud dispatch model lets users fire off pipelines and stream results back — or walk away and check status later.

## Architecture

```
┌──────────┐   POST /run        ┌─────────────────────────────────────┐
│           │ ─────────────────→ │  Cloudflare Worker (router)         │
│  pi CLI   │   {spec, input}   │    │                                │
│           │                    │    ▼                                │
│           │   SSE stream       │  Durable Object: PipelineRun-{id}  │
│           │ ←───────────────── │    ├─ state: spec, results[], input│
│           │                    │    ├─ step → Container ──→ result  │
│           │   GET /status/{id} │    ├─ pool(N) → N Containers       │
│           │ ─────────────────→ │    └─ parallel → M Containers      │
│           │ ←───────────────── │                                    │
└──────────┘                    └─────────────────────────────────────┘
                                          │
                                          ▼
                                ┌─────────────────────┐
                                │ Cloudflare Container │ (×N for pools)
                                │  pi --headless       │
                                │  runs single step    │
                                │  returns JSON        │
                                └─────────────────────┘
```

## Prerequisites

These capabilities must exist in pi / pi-captain before cloud dispatch works:

| Prerequisite | Description | Status |
|---|---|---|
| **Headless mode** | `pi --headless --agent <name> --prompt <text>` — run a single agent step, output JSON to stdout, no TUI | ❌ Needs pi core |
| **Pipeline spec export** | `captain_define` produces a JSON file that fully describes agents + pipeline tree | ❌ |
| **Step-level execution** | Ability to run one step in isolation given agent config + prompt | ❌ |
| **Auth token** | API key for authenticating dispatch requests to the cloud endpoint | ❌ |

## Components

### 1. Cloud Service (`captain-cloud`)

A Cloudflare Workers project deployed independently. Not part of the pi-captain package itself — it's the server-side counterpart.

#### Worker (Router)

Handles two endpoints:

- `POST /run` — accepts `{spec, input, apiKey}`, creates a Durable Object, returns SSE stream
- `GET /status/{id}` — returns current pipeline state from Durable Object storage

Authentication via `Authorization: Bearer <token>` header, validated against a stored secret.

#### Durable Object: `PipelineRun`

One instance per pipeline execution. Responsibilities:

- **Parse the pipeline spec** and walk the Runnable tree (sequential / parallel / pool)
- **Dispatch steps to Containers** via service binding
- **Chain `$INPUT` / `$ORIGINAL`** substitution between steps
- **Evaluate gates** — `command` gates run inside the container, `llm` gates call the LLM API directly from the DO
- **Handle failures** — retry (using DO alarms for backoff), skip, or fallback per step config
- **Persist state** after every step to DO storage — crash-safe, resumable
- **Stream SSE events** to the connected client: `step:start`, `step:done`, `parallel:start`, `pool:done`, `gate:result`, `pipeline:done`, `pipeline:error`
- **Hibernate** between long container calls — costs nothing while waiting

State schema stored in DO:

```typescript
interface PipelineState {
  id: string;
  spec: PipelineSpec;
  originalInput: string;
  currentInput: string;
  status: "running" | "done" | "failed" | "paused";
  results: StepResult[];
  startedAt: number;
  completedAt?: number;
  error?: string;
}

interface StepResult {
  label: string;
  agent: string;
  output: string;
  duration: number;
  gate?: { type: string; passed: boolean; reason: string };
  retries: number;
}
```

#### Containers

Each container runs a minimal HTTP server that:

1. Receives `{agent, prompt, tools, description}` via POST
2. Runs `pi --headless` with the agent config
3. Returns the output as JSON
4. For `command` gates: executes the command inside the container and returns exit code + output

Container image: Node.js + pi installed globally. The repo being worked on is cloned into the container from a git URL passed in the dispatch payload.

### 2. CLI Integration (`captain_run --cloud`)

Extension to the existing `captain_run` tool or a new `captain_dispatch` tool.

#### Dispatch Flow

1. User runs a pipeline with `--cloud` flag (or a dedicated `captain_dispatch` tool)
2. CLI serializes the full pipeline spec (agents + pipeline tree) to JSON
3. POSTs to the configured cloud endpoint with the spec + input
4. Opens SSE connection and streams events to the TUI
5. On `pipeline:done`, displays final output

#### Configuration

Stored in pi settings (`~/.pi/agent/settings.json` or `.pi/settings.json`):

```json
{
  "captain": {
    "cloud": {
      "url": "https://captain-cloud.<account>.workers.dev",
      "apiKey": "sk-...",
      "gitRemote": "origin"
    }
  }
}
```

`gitRemote` tells the cloud service which git remote to clone — the container needs the repo to run tools like `bash`, `read`, `edit`.

#### Offline / Detached Mode

If the SSE connection drops or the user passes `--detach`:

- The pipeline keeps running (Durable Object is independent)
- User can check later with `captain_status --cloud --id <id>`
- Results are stored in DO storage indefinitely (or with configurable TTL)

### 3. Pipeline Spec Serialization

The full pipeline must be serializable to a single JSON document:

```json
{
  "version": 1,
  "agents": {
    "reviewer": {
      "description": "Reviews code for quality",
      "tools": "read,bash",
      "model": "sonnet",
      "temperature": 0
    }
  },
  "pipeline": {
    "kind": "sequential",
    "steps": [
      {
        "kind": "step",
        "label": "Review",
        "agent": "reviewer",
        "prompt": "Review this code: $INPUT",
        "gate": { "type": "llm", "prompt": "Is the review thorough?", "threshold": 0.7 },
        "onFail": { "action": "retry", "max": 2 }
      }
    ]
  },
  "context": {
    "gitRemote": "https://github.com/org/repo.git",
    "gitRef": "feature-branch",
    "workdir": "/"
  }
}
```

## Execution Model

### Sequential Steps

DO executes steps one at a time. After each step:
1. Save result to DO storage
2. Update `currentInput` with step output
3. Evaluate gate if present
4. Send SSE event
5. Proceed to next step (or handle failure)

### Parallel Steps

DO dispatches all steps to separate containers concurrently via `Promise.all`. Each container gets the same `currentInput`. Results are merged using the configured strategy.

### Pool Steps

Same as parallel but N copies of the same step. Merge strategies:
- `concat` — join all outputs
- `vote` — majority answer (LLM-judged similarity)
- `rank` — LLM ranks outputs, pick best
- `firstPass` — first result whose gate passes

### Gate Evaluation in the Cloud

| Gate Type | Where it runs |
|---|---|
| `command` | Inside the container (has the repo) |
| `llm` | Durable Object calls LLM API directly (no container needed) |
| `assert` | Durable Object evaluates the assertion |
| `file` | Inside the container (has the repo) |
| `user` | Pauses pipeline, sends SSE `gate:user-required`, waits for `POST /gate/{id}/approve` |
| `none` | Always passes |

### User Gates in the Cloud

When a `user` gate is hit:
1. DO pauses and hibernates
2. SSE sends `gate:user-required` with the step output and gate prompt
3. CLI shows the output and asks user for approval
4. User approves/rejects → CLI POSTs to `POST /gate/{id}/{stepIndex}/approve` or `reject`
5. DO wakes up and continues or fails

## API

### `POST /run`

```
Authorization: Bearer <apiKey>
Content-Type: application/json

{
  "spec": { ... },       // Full pipeline spec JSON
  "input": "...",         // Initial $INPUT / $ORIGINAL
}

Response: 200 OK
Content-Type: text/event-stream
X-Pipeline-Id: <uuid>

data: {"type":"step:start","label":"Review"}
data: {"type":"step:done","label":"Review","output":"...","duration":4200}
data: {"type":"gate:result","label":"Review","passed":true}
data: {"type":"pipeline:done","output":"..."}
```

### `GET /status/{id}`

```
Authorization: Bearer <apiKey>

Response: 200 OK
{
  "id": "...",
  "status": "running",
  "results": [...],
  "currentStep": "Review",
  "startedAt": 1709600000000
}
```

### `POST /gate/{id}/{stepIndex}/approve`

```
Authorization: Bearer <apiKey>
{ "approved": true, "feedback": "looks good" }
```

### `DELETE /run/{id}`

Cancel a running pipeline. DO cleans up containers and sets status to `cancelled`.

## Deployment

```toml
# wrangler.toml
name = "captain-cloud"
main = "src/index.ts"
compatibility_date = "2025-12-01"

[durable_objects]
bindings = [
  { name = "PIPELINE_RUN", class_name = "PipelineRun" }
]

[[containers]]
name = "PI_CONTAINER"
image = "./container/Dockerfile"
max_instances = 20

[vars]
MAX_PIPELINE_DURATION_MS = "3600000"  # 1 hour default

# Secrets (set via `wrangler secret put`)
# - API_KEY: auth token for dispatch requests
# - ANTHROPIC_API_KEY: for LLM gates and agent steps
# - GITHUB_TOKEN: for git clone, push branches, and PR creation
```

## Scaling & Limits

| Dimension | Limit | Notes |
|---|---|---|
| Concurrent pipelines | Unlimited (1 DO per pipeline) | Each DO is independent |
| Parallel steps | `max_instances` containers | Default 20 |
| Pool workers | Same as parallel | Shares container pool |
| Step duration | No hard limit | DO hibernates while waiting |
| Pipeline duration | Configurable | Default 1 hour |
| State size | 128KB per DO | Enough for most pipelines; large outputs should be truncated/summarized |
| SSE connection | Browser/client dependent | Reconnect with `Last-Event-ID` |

## Cost Estimate

| Component | Cost |
|---|---|
| Worker invocations | $0.50 / million requests |
| Durable Object | $0.15 / million requests + $0.20 / GB-month storage |
| Container runtime | $0.005 / vCPU-second |
| **Typical 5-step pipeline** | **~$0.01 orchestration + LLM API costs** |

## Git Integration & Pull Requests

Since containers have the repo cloned and pi has `bash`/`edit`/`write` tools, pipelines can make code changes. With a `GITHUB_TOKEN` stored as a Cloudflare secret, the container can push branches and create PRs — turning a pipeline into a fully autonomous code contributor.

### How It Works

1. Container clones the repo using `GITHUB_TOKEN` for auth:
   ```
   git clone https://x-access-token:<GITHUB_TOKEN>@github.com/org/repo.git
   ```
2. Pi agent executes the step — edits files, runs tests, etc.
3. A **post-step hook** or a dedicated pipeline step commits and pushes:
   ```bash
   git checkout -b captain/{pipeline-id}/{step-label}
   git add -A
   git commit -m "captain: {step description}"
   git push origin HEAD
   ```
4. Creates a PR via GitHub API:
   ```bash
   gh pr create --title "captain: {pipeline label}" \
     --body "{step output / summary}" \
     --base main
   ```

### Pipeline-Aware PR Creation

The Durable Object controls when a PR is created based on pipeline config:

```json
{
  "kind": "sequential",
  "steps": [
    { "kind": "step", "label": "implement", "agent": "coder", "prompt": "..." },
    { "kind": "step", "label": "test", "agent": "tester", "prompt": "...",
      "gate": { "type": "command", "value": "npm test" } },
    { "kind": "step", "label": "review", "agent": "reviewer", "prompt": "..." }
  ],
  "output": {
    "pr": {
      "enabled": true,
      "base": "main",
      "branch": "captain/{id}",
      "title": "feat: {from pipeline label}",
      "labels": ["captain", "automated"],
      "reviewers": ["pierre-mikel"],
      "draft": false
    }
  }
}
```

The PR is created **after the final step passes all gates** — not before. If any gate fails, no PR is created, and the status reflects the failure.

### PR Body

Auto-generated from pipeline results:

```markdown
## Captain Pipeline Run

**Pipeline:** full-feature-build
**Triggered by:** @pierre-mikel via CLI
**Duration:** 3m 42s

### Steps

| Step | Agent | Duration | Gate |
|------|-------|----------|------|
| ✅ Implement | coder | 2m 10s | — |
| ✅ Test | tester | 45s | `npm test` passed |
| ✅ Review | reviewer | 47s | LLM gate 0.85/0.7 |

### Summary
{final step output}

---
*Created by [captain-cloud](https://github.com/org/pi-captain) — pipeline `full-feature-build`*
```

### Token Permissions

The `GITHUB_TOKEN` needs these scopes:

| Scope | Why |
|---|---|
| `repo` | Clone private repos, push branches |
| `pull_requests:write` | Create PRs |
| `metadata:read` | List repos, branches |

Can be a **GitHub App installation token** (preferred — scoped to specific repos) or a **fine-grained PAT**.

### Multi-Repo Pipelines

A pipeline can work across repos. Each step specifies its target:

```json
{
  "kind": "step",
  "label": "update-api-client",
  "agent": "coder",
  "prompt": "Update the generated API client",
  "context": {
    "gitRemote": "https://github.com/org/frontend.git",
    "gitRef": "main"
  }
}
```

Each container clones the appropriate repo. The DO can create PRs across multiple repos from a single pipeline run.

### SSE Events for Git/PR

```
data: {"type":"git:push","branch":"captain/abc123/implement","sha":"a1b2c3d"}
data: {"type":"pr:created","number":42,"url":"https://github.com/org/repo/pull/42"}
data: {"type":"pr:draft","number":42}
```

## Security

- All endpoints require `Authorization: Bearer <token>`
- Pipeline specs are validated before execution — only allowed tools/models
- Containers run in isolation, no cross-pipeline access
- Git credentials for repo cloning passed as encrypted secrets, never stored in DO state
- DO storage is encrypted at rest
- TTL on pipeline state (default 24h) — auto-cleanup via DO alarm

## Implementation Phases

### Phase 1: Foundation
- [ ] Pi headless mode (single-step execution, JSON output)
- [ ] Pipeline spec export (`captain_define` → JSON file)
- [ ] Pipeline spec import (`captain_load` from JSON)

### Phase 2: Cloud Service
- [ ] Scaffold `captain-cloud` Cloudflare Workers project
- [ ] Implement Worker router (`POST /run`, `GET /status`)
- [ ] Implement `PipelineRun` Durable Object (sequential execution only)
- [ ] Build container image with pi headless
- [ ] End-to-end: dispatch a single-step pipeline from CLI, get result via SSE

### Phase 3: Full Pipeline Support
- [ ] Parallel step dispatch (concurrent containers)
- [ ] Pool step dispatch (N containers + merge)
- [ ] Gate evaluation (command, llm, assert, file)
- [ ] Failure handling (retry with alarms, skip, fallback)
- [ ] User gate (pause/resume via API)

### Phase 4: CLI Integration
- [ ] `captain_dispatch` tool or `--cloud` flag on `captain_run`
- [ ] SSE streaming in TUI
- [ ] Detached mode + `captain_status --cloud`
- [ ] Settings for cloud URL, API key, git remote

### Phase 5: Git & PR Integration
- [ ] Container git clone with `GITHUB_TOKEN` auth
- [ ] Post-pipeline branch push from container
- [ ] PR creation via GitHub API (title, body, labels, reviewers from spec)
- [ ] Auto-generated PR body from pipeline results
- [ ] `output.pr` config in pipeline spec
- [ ] Multi-repo support (per-step `context.gitRemote`)
- [ ] SSE events for git push and PR creation
- [ ] GitHub App installation token support

### Phase 6: Production Hardening
- [ ] Reconnection (SSE `Last-Event-ID`)
- [ ] Pipeline cancellation (`DELETE /run/{id}`)
- [ ] State TTL and cleanup
- [ ] Rate limiting
- [ ] Observability (logs, metrics, trace IDs)
- [ ] Multi-tenant support (multiple API keys, usage tracking)
