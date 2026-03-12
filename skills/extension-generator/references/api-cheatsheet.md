# Extension API Cheatsheet

Complete reference for `ExtensionAPI` (pi) and `ExtensionContext` (ctx) methods. Read this when writing any extension.

---

## ExtensionAPI (pi)

### Event subscription

```typescript
pi.on(eventName, async (event, ctx) => { /* ... */ });
```

All events and their return shapes:

| Event | Fired when | Can return |
|-------|-----------|-----------|
| `session_start` | Session first loaded | void |
| `session_switch` | After `/new` or `/resume` | void |
| `session_before_switch` | Before `/new` or `/resume` | `{ cancel: true }` or void |
| `session_fork` | After `/fork` | void |
| `session_before_fork` | Before `/fork` | `{ cancel: true }` or `{ skipConversationRestore: true }` |
| `session_before_compact` | Before compaction | `{ cancel: true }` or `{ compaction: { summary, firstKeptEntryId, tokensBefore } }` |
| `session_compact` | After compaction | void |
| `session_before_tree` | Before `/tree` nav | `{ cancel: true }` or `{ summary: { summary, details } }` |
| `session_tree` | After `/tree` nav | void |
| `session_shutdown` | On exit | void |
| `before_agent_start` | After prompt, before agent | `{ message?, systemPrompt? }` or void |
| `agent_start` | Agent loop begins | void |
| `agent_end` | Agent loop ends | void |
| `turn_start` | Each LLM turn begins | void |
| `turn_end` | Each LLM turn ends | void |
| `context` | Before each LLM call | `{ messages: Message[] }` or void |
| `message_start` | Message lifecycle | void |
| `message_update` | Streaming update | void |
| `message_end` | Message complete | void |
| `tool_call` | Before tool executes | `{ block: true, reason: string }` or void |
| `tool_execution_start` | Tool begins | void |
| `tool_execution_update` | Tool streaming | void |
| `tool_execution_end` | Tool done | void |
| `tool_result` | After tool executes | `{ content?, details?, isError? }` or void |
| `model_select` | Model changed | void |
| `input` | User submits input | `{ action: "continue" \| "handled" \| "transform", text? }` |
| `user_bash` | User runs `!cmd` | `{ result: ... }` or `{ operations: ... }` or void |

---

### Tool registration

```typescript
pi.registerTool({
  name: "snake_case_name",    // Required, snake_case
  label: "Display Name",      // Required, shown in TUI
  description: "...",         // Required, shown to LLM
  parameters: Type.Object({   // Required, TypeBox schema
    text: Type.String(),
    flag: Type.Optional(Type.Boolean()),
    kind: StringEnum(["a", "b"] as const), // Use StringEnum for enums!
  }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // signal?.aborted — check for cancellation
    // onUpdate?.({ content: [...] }) — stream progress
    // pi.exec() — run shell commands
    return {
      content: [{ type: "text", text: "result" }],
      details: { ... },         // Optional, for rendering and state
      isError: false,           // Optional, flags error to LLM
    };
  },
  renderCall(args, theme) { return new Text("...", 0, 0); },   // Optional
  renderResult(result, { expanded, isPartial }, theme) { ... }, // Optional
});
```

### Command registration

```typescript
pi.registerCommand("cmd-name", {
  description: "...",
  getArgumentCompletions: (prefix) => [{ value: "foo", label: "Foo" }], // Optional
  handler: async (args, ctx) => {
    // ctx is ExtensionCommandContext — has waitForIdle(), newSession(), fork(), navigateTree(), reload()
    await ctx.waitForIdle();
    ctx.ui.notify("Done", "info");
  },
});
```

### Shortcut registration

```typescript
pi.registerShortcut("ctrl+shift+k", {
  description: "...",
  handler: async (ctx) => { ctx.ui.notify("Shortcut!", "info"); },
});
```

### Flag registration

```typescript
pi.registerFlag("my-flag", { description: "...", type: "boolean", default: false });
// Read: pi.getFlag("--my-flag")
```

### Messaging

```typescript
// Inject custom message (not a user message)
pi.sendMessage({ customType: "my-ext", content: "...", display: true }, {
  triggerTurn: true,          // Trigger LLM response if idle
  deliverAs: "steer",         // "steer" | "followUp" | "nextTurn"
});

// Send as user message (triggers turn)
pi.sendUserMessage("What is 2+2?");
pi.sendUserMessage("...", { deliverAs: "steer" }); // If streaming

// Render custom messages in TUI
pi.registerMessageRenderer("my-ext", (message, { expanded }, theme) => {
  return new Text(theme.fg("accent", message.content), 0, 0);
});
```

### Tool management

```typescript
const active = pi.getActiveTools();       // ["read", "bash", ...]
const all = pi.getAllTools();             // [{ name, description }, ...]
pi.setActiveTools(["read", "bash"]);     // Restrict active tools
```

### Session metadata

```typescript
pi.setSessionName("Refactor auth module");
pi.getSessionName();
pi.setLabel(entryId, "checkpoint");       // Label an entry for /tree
pi.appendEntry("my-type", { data: 42 }); // Persist non-tool state
```

### Shell execution

```typescript
const { stdout, stderr, code } = await pi.exec("git", ["status"], { signal, timeout: 5000 });
```

### Model / thinking

```typescript
const model = ctx.modelRegistry.find("anthropic", "claude-sonnet-4-5");
await pi.setModel(model);
pi.getThinkingLevel();                    // "off" | "minimal" | ... | "xhigh"
pi.setThinkingLevel("high");
```

### Provider registration

```typescript
pi.registerProvider("my-proxy", { baseUrl: "...", apiKey: "MY_KEY", api: "anthropic-messages", models: [...] });
```

### Shared event bus (inter-extension)

```typescript
pi.events.on("my:event", (data) => { ... });
pi.events.emit("my:event", { ... });
```

---

## ExtensionContext (ctx)

Available in every event handler and tool `execute`:

```typescript
ctx.ui.notify(msg, "info" | "warning" | "error")
ctx.ui.setStatus(key, text | undefined)      // Footer status
ctx.ui.setWidget(key, string[] | undefined)          // Panel above editor (static)
ctx.ui.setWidget(key, (_tui, theme) => ({            // Panel above editor (dynamic, width-aware)
  render(width: number): string[],                   //   called on each TUI redraw — MUST return
  invalidate(): void,                                //   lines where visibleWidth(l) ≤ width
}) | undefined)
ctx.ui.select(title, options[])              // → string | undefined
ctx.ui.confirm(title, body, opts?)           // → boolean
ctx.ui.input(label, placeholder?)            // → string | undefined
ctx.ui.editor(label, prefill?)              // → string | undefined
ctx.ui.custom<T>(factory, opts?)            // → T
ctx.ui.setTitle(title)
ctx.ui.setEditorText(text)
ctx.ui.setToolsExpanded(bool)

ctx.hasUI               // false in print/JSON mode
ctx.cwd                 // working directory
ctx.sessionManager.getEntries()             // All entries
ctx.sessionManager.getBranch()              // Current branch root→leaf
ctx.sessionManager.getLeafId()             // Current leaf entry ID
ctx.sessionManager.getLeafEntry()
ctx.sessionManager.getSessionFile()        // Path to session file
ctx.isIdle()
ctx.abort()
ctx.compact({ customInstructions?, onComplete?, onError? })
ctx.getContextUsage()                      // { tokens, maxTokens } — ⚠️ `maxTokens` can be undefined/0; never use it as a divisor or fallback to 1 (causes overflow). Check `if (!maxTokens || maxTokens <= 0)` and show a fallback message instead of computing percentages.
ctx.getSystemPrompt()
ctx.shutdown()                             // Graceful exit
ctx.modelRegistry
ctx.model
```

ExtensionCommandContext (command handlers only) adds:

```typescript
ctx.waitForIdle()
ctx.newSession(opts?)
ctx.fork(entryId)
ctx.navigateTree(targetId, opts?)
ctx.reload()
```

---

## Truncation utilities

```typescript
import { truncateHead, truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "@mariozechner/pi-coding-agent";

const { content, truncated, totalLines, outputLines, totalBytes, outputBytes } = truncateHead(text, {
  maxLines: DEFAULT_MAX_LINES, // 2000
  maxBytes: DEFAULT_MAX_BYTES, // 50KB
});

// truncateTail — use when end of output matters (logs)
const result = truncateTail(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
```

## Type narrowing for built-in tools

```typescript
import { isToolCallEventType, isBashToolResult } from "@mariozechner/pi-coding-agent";

// In tool_call handler:
if (isToolCallEventType("bash", event))  event.input.command   // string
if (isToolCallEventType("read", event))  event.input.path      // string
if (isToolCallEventType("write", event)) event.input.path      // string
if (isToolCallEventType("edit", event))  event.input.path      // string

// In tool_result handler:
if (isBashToolResult(event))  event.details  // BashToolDetails
```

## Typed built-in tool details (for renderResult overrides)

```typescript
import type { ReadToolDetails, BashToolDetails, EditToolDetails } from "@mariozechner/pi-coding-agent";

// ReadToolDetails
details.truncation?.truncated      // boolean
details.truncation?.totalLines     // number
details.truncation?.outputLines    // number

// BashToolDetails
details.truncation?.truncated      // boolean

// EditToolDetails
details.diff                       // unified diff string — parse for +/- counts
```

## Creating cwd-aware built-in tool instances

Always use `ctx.cwd` inside `execute` (not `process.cwd()`). Cache by cwd to avoid re-creating:

```typescript
import { createReadTool, createBashTool, createEditTool, createWriteTool, createFindTool, createGrepTool, createLsTool } from "@mariozechner/pi-coding-agent";

const cache = new Map<string, any>();
function getTool<T>(cwd: string, factory: (cwd: string) => T): T {
  if (!cache.has(cwd)) cache.set(cwd, factory(cwd));
  return cache.get(cwd) as T;
}

// Inside execute:
async execute(id, params, signal, onUpdate, ctx) {
  return getTool(ctx.cwd, createReadTool).execute(id, params, signal, onUpdate);
}
```

## bash-spawn-hook

Adjust command, cwd, or env for every bash call:

```typescript
import { createBashTool } from "@mariozechner/pi-coding-agent";

const bashTool = createBashTool(process.cwd(), {
  spawnHook: ({ command, cwd, env }) => ({
    command: `source ~/.profile && ${command}`,
    cwd,
    env: { ...env, CUSTOM_VAR: "value" },
  }),
});
```

## resources_discover event

Register dynamic skills, prompt templates, or themes from within an extension:

```typescript
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const baseDir = dirname(fileURLToPath(import.meta.url));

pi.on("resources_discover", () => ({
  skillPaths:  [join(baseDir, "skills/SKILL.md")],
  promptPaths: [join(baseDir, "prompts/my-prompt.md")],
  themePaths:  [join(baseDir, "themes/my-theme.json")],
}));
```

## Keyboard shortcuts with Key helper

```typescript
import { Key } from "@mariozechner/pi-tui";

pi.registerShortcut(Key.ctrlShift("u"), { description: "...", handler: async (ctx) => { ... } });
pi.registerShortcut(Key.ctrl("k"),      { description: "...", handler: async (ctx) => { ... } });
pi.registerShortcut("ctrl+shift+p",    { description: "...", handler: async (ctx) => { ... } }); // string form also works
```

## CLI flags

```typescript
pi.registerFlag("preset", { description: "Preset to activate", type: "string" });
pi.registerFlag("dry-run", { description: "Skip writes", type: "boolean", default: false });

// Read flag value (in event handlers, after session_start):
const presetName = pi.getFlag("preset");     // string | undefined
const dryRun = pi.getFlag("--dry-run");      // boolean
```

## Advanced TUI components (SelectList, DynamicBorder)

```typescript
import { Container, SelectList, Text, type SelectItem } from "@mariozechner/pi-tui";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";

const items: SelectItem[] = [
  { value: "plan", label: "Plan Mode", description: "Read-only tools, deep analysis" },
  { value: "code", label: "Code Mode", description: "Full tools, implementation" },
];

const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
  const container = new Container();
  container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));
  container.addChild(new Text(theme.fg("accent", theme.bold("Select Mode"))));

  const list = new SelectList(items, Math.min(items.length, 8), {
    selectedPrefix: (t) => theme.fg("accent", t),
    selectedText:   (t) => theme.fg("accent", t),
    description:    (t) => theme.fg("muted", t),
    scrollInfo:     (t) => theme.fg("dim", t),
  });
  list.onSelect = (item) => done(item.value);
  list.onCancel = () => done(null);
  container.addChild(list);
  container.addChild(new DynamicBorder((str) => theme.fg("accent", str)));

  return {
    render(width)   { return container.render(width); },
    invalidate()    { container.invalidate(); },
    handleInput(d)  { list.handleInput(d); tui.requestRender(); },
  };
});
```

## LLM completion inside extension (for compaction, summarization)

```typescript
import { complete, stream } from "@mariozechner/pi-ai";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const model = ctx.modelRegistry.find("google", "gemini-2.5-flash");
const apiKey = model ? await ctx.modelRegistry.getApiKey(model) : null;
if (!model || !apiKey) return;

// ── complete() — single blocking call, returns final AssistantMessage ───────
const response = await complete(
  model,
  { messages: [{ role: "user", content: [{ type: "text", text: "Summarize: ..." }], timestamp: Date.now() }] },
  { apiKey, maxTokens: 4096, signal }
);
const text = response.content
  .filter((c): c is { type: "text"; text: string } => c.type === "text")
  .map((c) => c.text).join("\n");

// ── stream() — streaming call, use for live widget updates ──────────────────
// Emits AssistantMessageEvent: text_delta, thinking_delta, done, error
const eventStream = stream(
  model,
  { messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }] },
  { apiKey, maxTokens: 16384, signal }
);

let textBuffer = "";
let lastLine = "";
for await (const event of eventStream) {
  if (event.type === "text_delta") {
    textBuffer += event.delta;
    const lines = textBuffer.split("\n").filter(l => l.trim());
    lastLine = lines[lines.length - 1] ?? "";
    updateWidget(ctx, lastLine);   // drive the TUI on every token
  } else if (event.type === "thinking_delta") {
    // Only fires on models with extended thinking (e.g. Claude 3.7 Sonnet)
  } else if (event.type === "error") {
    throw new Error(event.error.errorMessage ?? "LLM error");
  }
}
// textBuffer now holds the full response

// Convert session messages to LLM format then serialize to text:
const conversationText = serializeConversation(convertToLlm(messages));
```

## External integration via file watcher

```typescript
import * as fs from "node:fs";

pi.on("session_start", async (_e, ctx) => {
  const triggerFile = "/tmp/agent-trigger.txt";

  fs.watch(triggerFile, () => {
    try {
      const content = fs.readFileSync(triggerFile, "utf-8").trim();
      if (content) {
        pi.sendMessage(
          { customType: "file-trigger", content, display: true },
          { triggerTurn: true }  // Immediately get LLM to respond
        );
        fs.writeFileSync(triggerFile, "");
      }
    } catch { /* file may not exist yet */ }
  });

  ctx.ui.notify(`Watching ${triggerFile}`, "info");
});
```

## Project-local config + system prompt injection

Scan the filesystem at session start and inject paths/content into the system prompt so the LLM knows to read them:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";

let ruleFiles: string[] = [];

pi.on("session_start", async (_e, ctx) => {
  const rulesDir = path.join(ctx.cwd, ".claude", "rules");
  if (fs.existsSync(rulesDir)) {
    ruleFiles = fs.readdirSync(rulesDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name);
  }
});

pi.on("before_agent_start", async (event) => {
  if (ruleFiles.length === 0) return;
  const list = ruleFiles.map((f) => `- .claude/rules/${f}`).join("\n");
  return {
    systemPrompt: event.systemPrompt + `\n\n## Project Rules\n${list}\nLoad relevant rules with the read tool.`,
  };
});
```
