# 🔒 Safety Guard: Path Protection

Protects sensitive directories and files from unauthorized access across all tool types (`read`, `write`, `edit`, and `bash`).

## What it protects

### 🔴 Blocked — read & write

| Path | Why |
|------|-----|
| `.git/` internals | Prevents repository corruption (loose objects, refs, config) |

### 🔴 Blocked — write only (read allowed)

| Path | Why |
|------|-----|
| `node_modules/` | Managed by package managers — direct edits break lockfile integrity |
| `.env`, `.env.local`, `.env.production`, `.env.*` | Secrets files — agent must never modify credentials |

### 🟡 Confirmation required — write only

| Path | Why |
|------|-----|
| `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `bun.lock` | Lock files are auto-generated — edits can corrupt dependency resolution |
| `Gemfile.lock`, `poetry.lock`, `Cargo.lock`, `go.sum`, `composer.lock` | Same for non-JS ecosystems |
| `Dockerfile`, `docker-compose.yml` | Infrastructure config — changes may affect production |
| `.github/workflows/`, `.circleci/` | CI/CD pipelines — unauthorized changes can trigger deploys |
| `.gitlab-ci.yml` | GitLab CI config |

## How it works

### File tools (`read`, `write`, `edit`)

The extension checks the `path` parameter against the rules above. Read operations are more permissive (only `.git/` is blocked).

### Bash commands

The extension extracts path references from bash commands using regex and applies the same rules. Read-only commands (`cat`, `grep`, `ls`, `find`, `head`, `tail`, etc.) get the read-mode rules (more permissive).

**Example:** `cat .git/config` → blocked. `cat node_modules/lodash/package.json` → allowed. `echo "test" > node_modules/foo.js` → blocked.

## Behavior

| Mode | Action |
|------|--------|
| **Interactive** | Shows dialog explaining which path is protected and why |
| **Non-interactive** | Blocks with descriptive reason |

## Status bar

Shows `🔒 path-guard` in the footer when active.

## Installation

Already active — lives in `~/.pi/agent/extensions/safety-path-protection/index.ts` and auto-loads with every pi session.

## Example

```
🔒 Protected file
  .github/workflows/deploy.yml

  CI/CD configuration — confirm before editing

  Allow?

  [Yes]  [No]
```
