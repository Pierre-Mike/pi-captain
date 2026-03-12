# Use the right event for each interception point

Picking the wrong event leads to either missed interceptions or overly complex handlers. Each event fires at a specific point in pi's lifecycle and accepts specific return shapes.

## Avoid

```typescript
// Wrong: using agent_start to inject system prompt additions
pi.on("agent_start", async (event, ctx) => {
  // agent_start is read-only, cannot modify system prompt here
});

// Wrong: blocking tool calls from tool_result (too late — already executed)
pi.on("tool_result", async (event, ctx) => {
  return { block: true }; // NOT a valid return shape for tool_result
});

// Wrong: forgetting to return undefined to allow (returning nothing still works,
// but the pattern below makes intent explicit and avoids accidental blocking)
pi.on("tool_call", async (event, ctx) => {
  if (notDangerous) {
    // Missing return — works but ambiguous
  }
  return { block: true, reason: "..." };
});
```

## Prefer

Use this decision table to choose the right event:

| Goal | Event | Return shape |
|------|-------|-------------|
| Block or allow a tool before it runs | `tool_call` | `{ block: true, reason: string }` or `undefined` |
| Modify tool output after execution | `tool_result` | `{ content?, details?, isError? }` or `undefined` |
| Inject context / modify system prompt per turn | `before_agent_start` | `{ message?, systemPrompt? }` or `undefined` |
| Filter or rewrite LLM message history each turn | `context` | `{ messages: Message[] }` or `undefined` |
| Transform user input before agent sees it | `input` | `{ action: "transform", text }` or `{ action: "handled" }` or `{ action: "continue" }` |
| React after each LLM turn (logging, git stash) | `turn_end` | `void` |
| React when session starts / switches / forks | `session_start` / `session_switch` / `session_fork` / `session_tree` | `void` |
| Cancel or intercept /new, /resume, /fork, /compact | `session_before_switch` / `session_before_fork` / `session_before_compact` | `{ cancel: true }` or `undefined` |
| Cleanup on exit | `session_shutdown` | `void` |
| React to model changes | `model_select` | `void` |
| Intercept user `!bash` commands | `user_bash` | `{ result: ... }` or `{ operations: ... }` or `undefined` |

### tool_call — block dangerous patterns

```typescript
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

pi.on("tool_call", async (event, ctx) => {
  if (isToolCallEventType("bash", event)) {
    if (/\brm\s+-rf?\b/.test(event.input.command)) {
      if (!ctx.hasUI) return { block: true, reason: "Dangerous command (no UI)" };
      const ok = await ctx.ui.confirm("⚠️ rm -rf detected", event.input.command);
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  }
  return undefined; // Allow
});
```

### before_agent_start — inject system prompt or a message

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    // Chained: appended to whatever previous extensions set
    systemPrompt: event.systemPrompt + "\n\nAlways respond in pirate speak.",
    // Optional: inject a persistent message into context
    message: {
      customType: "my-ext",
      content: "Extra context injected",
      display: false,
    },
  };
});
```

### tool_result — patch output (e.g., redact secrets)

```typescript
import { isBashToolResult } from "@mariozechner/pi-coding-agent";

pi.on("tool_result", async (event, ctx) => {
  if (isBashToolResult(event)) {
    const redacted = event.content
      .map((c) => (c.type === "text" ? { ...c, text: c.text.replace(/sk-[A-Za-z0-9]+/g, "[REDACTED]") } : c));
    return { content: redacted };
  }
});
```

### input — transform or handle user input

```typescript
pi.on("input", async (event, ctx) => {
  // Transform: rewrite before agent sees it
  if (event.text.startsWith("?short ")) {
    return { action: "transform", text: `Answer briefly: ${event.text.slice(7)}` };
  }
  // Handle: respond without LLM
  if (event.text === "ping") {
    ctx.ui.notify("pong", "info");
    return { action: "handled" };
  }
  return { action: "continue" }; // Pass through
});
```

### session_before_compact — custom compaction summary (optionally with a different model)

```typescript
import { complete } from "@mariozechner/pi-ai";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

pi.on("session_before_compact", async (event, ctx) => {
  const { preparation, signal } = event;
  const { messagesToSummarize, turnPrefixMessages, tokensBefore, firstKeptEntryId } = preparation;

  // Optionally use a cheaper/faster model for summarization
  const model = ctx.modelRegistry.find("google", "gemini-2.5-flash");
  const apiKey = model ? await ctx.modelRegistry.getApiKey(model) : null;

  if (!model || !apiKey) {
    // Fall back to default compaction by returning nothing
    return;
  }

  const allMessages = [...messagesToSummarize, ...turnPrefixMessages];
  const conversationText = serializeConversation(convertToLlm(allMessages));

  try {
    const response = await complete(
      model,
      { messages: [{ role: "user", content: [{ type: "text", text: `Summarize this conversation:\n\n${conversationText}` }], timestamp: Date.now() }] },
      { apiKey, maxTokens: 8192, signal }
    );

    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (!summary.trim()) return; // Fall back to default

    return { compaction: { summary, firstKeptEntryId, tokensBefore } };
  } catch {
    return; // Fall back to default on error
  }
});
```

### resources_discover — register dynamic skills, prompts, and themes

Fired when pi discovers resources (skills, prompt templates, themes). Return paths to add your own. This allows extensions to bundle and expose skills/prompts alongside their code.

```typescript
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));

pi.on("resources_discover", () => {
  return {
    skillPaths: [join(baseDir, "my-skill/SKILL.md")],
    promptPaths: [join(baseDir, "prompts/my-prompt.md")],
    themePaths: [join(baseDir, "themes/my-theme.json")],
  };
});
```

This event fires at startup and on `/reload`. Use it when your extension ships with companion skills or prompt templates that should always be available.
