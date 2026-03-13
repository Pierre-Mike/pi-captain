# 💻 Terminal

Adds `/terminal` and `/t` commands to run shell commands in the current working directory and display output inline — with smart truncation and TUI notifications.

## Install

```bash
pi install npm:pi-terminal
```

## What it does

Registers two slash commands that execute arbitrary shell commands via `bash -c` with a 30-second timeout. Output is formatted with a header showing the command and working directory, then displayed as a TUI notification (for short output) or injected into the chat (for long output). Output is truncated to 200 lines / 20 KB with a tail-first strategy so the most relevant lines are always visible.

## Commands

| Command | Description |
|---|---|
| `/terminal <command>` | Run a shell command and display output |
| `/t <command>` | Alias for `/terminal` |

## Examples

```
/t npm test
/t git log --oneline -10
/terminal docker ps
```

## Output behaviour

| Output size | Display |
|---|---|
| ≤ 20 lines and < 800 chars | TUI notification (inline popup) |
| Larger | Injected into chat as a fenced code block |
| > 200 lines or > 20 KB | Truncated — last N lines shown with a truncation note |

Exit code is always shown. Non-zero exits display as an error notification.
