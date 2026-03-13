# pi-handoff

A pi extension that generates a **handoff prompt** for the next AI agent, then resets the session with that prompt pre-loaded in the editor.

## What it does

1. You type `/handoff` (optionally with extra instructions)
2. The LLM writes a comprehensive, self-contained prompt covering:
   - Project context and structure
   - Everything accomplished so far
   - Current state of the code/system
   - Prioritised next steps
   - Key constraints and decisions already made
   - How the next agent should start
3. The generated prompt is saved to a temp file
4. A fresh session starts (context cleared, runtime reloaded)
5. The handoff prompt is placed in the editor — review it and press **Enter** to kick off the next agent

## Usage

```
/handoff
/handoff focus on the authentication module
```

## Installation

Copy to `~/.pi/agent/extensions/handoff/` for global use, or `.pi/extensions/handoff/` for project-local use.
