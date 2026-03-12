# 🛡️ Safety Guard: Destructive Commands

Intercepts bash tool calls that match dangerous patterns and blocks or prompts for confirmation.

## What it protects against

### 🔴 Hard-blocked (always, no override)

| Pattern | Why |
|---------|-----|
| `dd … of=/dev/…` | Raw disk write — destroys partitions |
| `mkfs` | Formats a filesystem |
| `> /dev/sd*` | Redirect to raw block device |
| `rm -rf /` | Wipe root filesystem |
| Fork bombs `:(){ :\|:& };:` | Infinite process spawning |
| `shutdown`, `reboot`, `halt`, `poweroff` | System power control |
| `iptables -F` | Flush all firewall rules |

### 🟡 Confirmation required

| Pattern | Why |
|---------|-----|
| `rm -r`, `rm -f`, `rm -rf` | Recursive / forced deletion |
| `sudo …` | Elevated privileges |
| `chmod … 777`, `chmod -R` | Dangerous permission changes |
| `chown -R` | Recursive ownership change |
| `killall`, `pkill -9` | Mass process termination |
| `systemctl stop/disable/mask` | Disabling system services |
| `launchctl unload/remove` | Removing macOS services |
| `truncate`, `shred` | Destructive file operations |

### ✅ Safe exceptions (auto-allowed)

These common dev patterns are **not** intercepted:

- `rm -rf ./node_modules`
- `rm -rf ./dist`, `./build`, `./.next`, `./target`
- `rm -rf /tmp/…`

## Behavior

| Mode | Action |
|------|--------|
| **Interactive** | Shows confirmation dialog with the command |
| **Non-interactive** (headless/RPC) | Blocks outright with reason |

## Status bar

Shows `🛡️ cmd-guard` in the footer when active.

## Installation

Already active — lives in `~/.pi/agent/extensions/safety-destructive-commands/index.ts` and auto-loads with every pi session.

## Example

```
⚠️ Recursive delete (rm -r)
  rm -rf ./some-important-directory

  Allow this command?

  [Yes]  [No]
```
