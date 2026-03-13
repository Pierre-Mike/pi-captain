# 🧹 Clear

Adds `/clear` and `/c` commands (plus bare-message interception) to wipe the conversation context and start a fresh session with a full runtime reload.

## Install

```bash
pi install npm:pi-clear
```

## What it does

Registers two slash commands and an input interceptor. All three paths call the same logic: wait for the agent to be idle, start a new session, reload the runtime, and notify you that the slate is clean.

## Commands

| Command | Description |
|---|---|
| `/clear` | Clear context and start a fresh session |
| `/c` | Alias for `/clear` |

## Bare message interception

Typing `clear` or `c` as a plain message (without the `/` prefix) also triggers the clear, so you never accidentally send those words to the LLM.
