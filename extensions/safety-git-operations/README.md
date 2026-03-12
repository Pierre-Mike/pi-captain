# 🔀 Safety Guard: Git & SCM Operations

Guards all state-changing git operations and GitHub/GitLab CLI commands with severity-based confirmation and session memory.

## What it protects

### 🔴 Critical (confirm + 30s auto-deny timeout)

| Command | Why |
|---------|-----|
| `git push --force` / `-f` | Rewrites remote history — can lose collaborators' work |
| `git reset --hard` | Discards uncommitted changes permanently |
| `git clean -f` | Removes untracked files permanently |
| `git stash drop/clear` | Destroys stashed changes |
| `git branch -D` | Force-deletes branch even if unmerged |
| `git reflog expire` | Removes recovery points |
| `gh repo create/delete/rename/archive` | Irreversible GitHub repo operations |
| `gh secret set/delete` | Manages production secrets |
| `glab repo create/delete/archive` | Irreversible GitLab repo operations |

### 🟡 Standard (confirm with session-remember option)

| Command | Why |
|---------|-----|
| `git push` | Publishes commits to remote |
| `git commit` | Creates permanent history entry |
| `git rebase`, `git merge` | Rewrites/combines branch history |
| `git tag`, `git cherry-pick`, `git revert` | Modifies repository state |
| `git am` | Applies patches |
| `git branch -d` | Deletes merged branch |
| `gh pr create/merge/close` | GitHub PR lifecycle |
| `gh pr comment/review` | Public GitHub comments |
| `gh issue create/close/delete` | GitHub issue management |
| `gh release create/delete/edit` | GitHub release management |
| `glab mr create/merge/close` | GitLab MR lifecycle |
| `glab issue create/close/delete` | GitLab issue management |
| `glab release create/delete` | GitLab release management |

## Session memory

For **standard** operations, the confirmation dialog offers four choices:

| Choice | Effect |
|--------|--------|
| ✅ Allow once | Permits this single command |
| 🚫 Block once | Blocks this single command |
| ✅✅ Auto-approve for session | All future commands of this type pass silently |
| 🚫🚫 Auto-block for session | All future commands of this type are blocked silently |

Session memory resets on session start/switch. Critical operations never get session memory — they always require explicit confirmation.

## Commands

| Command | Description |
|---------|-------------|
| `/git-safety` | Show current session approvals and blocks |
| `/git-safety reset` | Clear all session overrides |

## Behavior

| Mode | Action |
|------|--------|
| **Interactive — critical** | Confirm dialog with 30-second auto-deny |
| **Interactive — standard** | Confirm dialog with session-remember options |
| **Non-interactive** | All operations blocked |

## Status bar

Shows `🔀 git-guard` in the footer when active.

## Installation

Already active — lives in `~/.pi/agent/extensions/safety-git-operations/index.ts` and auto-loads with every pi session.

## Example

```
🟡 push
  git push origin main

  Allow?

  ✅ Allow once
  🚫 Block once
  ✅✅ Auto-approve "push" for this session
  🚫🚫 Auto-block "push" for this session
```
