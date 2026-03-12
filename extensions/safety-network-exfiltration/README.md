# 🌐 Safety Guard: Network & Exfiltration Prevention

Prevents data exfiltration, remote code execution, and unauthorized network operations.

## What it protects against

### 🔴 Hard-blocked (always, no override)

#### Piped remote code execution

| Pattern | Why |
|---------|-----|
| `curl … \| sh/bash/zsh` | Executes untrusted remote code |
| `wget … \| sh/bash/zsh` | Same via wget |
| `curl … \| sudo sh` | Remote code as root |
| `bash <(curl …)` | Process substitution variant |
| `bash -c "$(curl …)"` | Command substitution variant |

#### Secrets in commands

| Pattern | Why |
|---------|-----|
| `curl -H "Authorization: Bearer <long-token>"` | Leaking API tokens in commands |
| `curl -d "password=…"` / `secret=…` / `api_key=…` | Sending credentials in POST data |
| `curl/scp/rsync … .env` / `.pem` / `.key` / `id_rsa` | Uploading secret files |
| `curl …?token=<long-value>&…` | Secrets in query parameters |

#### Exfiltration via file writes

The extension also scans the `write` tool's content for piped shell patterns, preventing scripts that would `curl | sh` from being saved to disk.

### 🟡 Confirmation required

#### Data upload

| Pattern | Why |
|---------|-----|
| `curl -X POST/PUT/PATCH/DELETE` | Sending data to external servers |
| `curl -d …` / `--data …` / `-F …` | Uploading data via curl |
| `wget --post-data/--post-file` | Uploading data via wget |

#### File transfer

| Pattern | Why |
|---------|-----|
| `scp … user@host:` | Copying files to remote server |
| `rsync … user@host:` | Syncing files to remote server |
| `nc` / `netcat` / `ncat` | Raw network socket access |
| `ssh -L/-R/-D` | SSH tunneling (potential exfil channel) |

#### Package publishing (irreversible)

| Pattern | Why |
|---------|-----|
| `npm publish` | Publishes package to npm registry |
| `cargo publish` | Publishes crate to crates.io |
| `gem push` | Publishes gem to RubyGems |
| `pip upload` | Uploads to PyPI |
| `docker push` | Pushes image to container registry |

## Behavior

| Mode | Action |
|------|--------|
| **Interactive — hard-block** | Notifies user, blocks with explanation |
| **Interactive — confirm** | Shows dialog with command preview |
| **Non-interactive** | All flagged operations blocked |

## Status bar

Shows `🌐 net-guard` in the footer when active.

## Installation

Already active — lives in `~/.pi/agent/extensions/safety-network-exfiltration/index.ts` and auto-loads with every pi session.

## Example — piped execution (blocked)

```
🚫 Blocked: piped remote code execution

Remote code execution via piped shell is never allowed.
Download the script first, review it, then run it.
```

## Example — data upload (confirmation)

```
🌐 Network: curl POST/PUT/PATCH/DELETE
  curl -X POST https://api.example.com/data -d '{"key": "value"}'

  This command sends data over the network. Allow?

  [Yes]  [No]
```
