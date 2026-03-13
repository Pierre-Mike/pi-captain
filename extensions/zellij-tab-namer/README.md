# 🪟 Zellij Tab Namer

Automatically renames the active Zellij tab to a short summary of the conversation after each agent turn. Uses a fast model to generate a concise 3–5 word label so you always know what each tab is doing at a glance.

## Install

```bash
pi install npm:pi-zellij-tab-namer
```

## Requirements

- [Zellij](https://zellij.dev) terminal multiplexer (auto-detected via `ZELLIJ` env var — does nothing outside Zellij)

## What it does

| Event | Action |
|---|---|
| Session start (existing session) | Generates a label from existing history |
| Agent turn ends | Schedules a rename based on the latest conversation |
| Session shutdown | Resets the tab name via `zellij action undo-rename-tab` |

Renames are debounced so rapid successive turns don't spam the Zellij API.

## How it works

After each turn, the extension passes the last few conversation entries to a fast/cheap model and asks it for a 3–5 word label. The label is then written to the active Zellij tab via the `zellij action rename-tab` command.
