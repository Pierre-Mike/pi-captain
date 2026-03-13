# 🌐 Native Web Search

Adds a `web_search` tool powered by Anthropic's native web search — no third-party API key, no browser, no proxy. Results come directly from Anthropic and are always run via `claude-haiku-4-5` for fast, cheap retrieval regardless of which model is active in the session.

## Install

```bash
pi install npm:pi-native-web-search
```

## What it does

Registers a `web_search` tool the LLM can call to look up current information: documentation, news, packages, changelogs, anything not in its training data. The tool returns a concise summary with source URLs.

## Tool: `web_search`

| Parameter | Type | Description |
|---|---|---|
| `query` | `string` | The search query. Be specific and concise for best results. |

## Why this over other search extensions?

| Feature | `pi-native-web-search` | Others |
|---|---|---|
| API key required | ❌ None | ✅ Linkup / Jina / SerpAPI |
| Headless browser | ❌ None | ✅ Some require Playwright |
| Provider | Anthropic native | Third-party |
| Model | `claude-haiku-4-5` (fast) | Varies |

## Requirements

- An active Anthropic API key in your pi session (already needed to run pi with Claude)
