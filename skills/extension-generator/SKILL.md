---
name: extension-generator
description: >
  Create, debug, and fix pi extensions — TypeScript modules that add custom tools,
  slash commands, event interceptors, stateful UI widgets, and bash wrappers.
  Covers registerTool(), permission gates, session state reconstruction,
  resources_discover for bundled skills, and spawn hooks.
  Activates on: "write/build/create a pi extension", "add a tool/command to pi",
  "fix/debug my extension", "extension crashes/doesn't work",
  "intercept tool calls", "inject context into prompts",
  "bundle a skill with an extension", "watch a file and trigger the agent"
---

# Extension Generator

## Core Concepts

**Extensions are TypeScript modules** loaded by pi via [jiti](https://github.com/unjs/jiti) — no compilation step. Export a single default function that receives `ExtensionAPI`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
```

**Placement** (pick one):
- `~/.pi/agent/extensions/my-ext.ts` — global, all projects, hot-reloadable via `/reload`
- `.pi/extensions/my-ext.ts` — project-local, hot-reloadable via `/reload`
- `pi -e ./my-ext.ts` — quick test only, not reloadable

**Available imports:**

| Package | Use for |
|---------|---------|
| `@mariozechner/pi-coding-agent` | `ExtensionAPI`, `ExtensionContext`, events, `isToolCallEventType`, `isBashToolResult`, `truncateHead`, `truncateTail`, `createReadTool`, `createBashTool`, `convertToLlm`, `serializeConversation`, `DynamicBorder`, `keyHint` |
| `@mariozechner/pi-coding-agent` (types) | `ReadToolDetails`, `BashToolDetails`, `EditToolDetails` |
| `@sinclair/typebox` | `Type` — schema for tool parameters |
| `@mariozechner/pi-ai` | `StringEnum` — Google-compatible string enums, `complete` — LLM completion |
| `@mariozechner/pi-tui` | `Text`, `Container`, `Spacer`, `SelectList`, `Key` — TUI rendering |
| `node:fs`, `node:path`, etc. | Node.js built-ins |

---

## The 5 Key Patterns

### 1 — Intercept tool calls (permission gates, path protection)

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event)) {
      if (event.input.command.includes("rm -rf")) {
        if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked" };
        const ok = await ctx.ui.confirm("Dangerous!", `Allow: ${event.input.command}?`);
        if (!ok) return { block: true, reason: "Blocked by user" };
      }
    }
    // Return undefined to allow
  });
}
```

Key: return `{ block: true, reason: "..." }` to block, `undefined` to allow. Always check `ctx.hasUI` before calling UI methods in non-interactive modes.

### 2 — Register a custom tool the LLM can call

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",           // snake_case
    label: "My Tool",          // Display name
    description: "What the LLM should call this tool for",
    parameters: Type.Object({
      action: StringEnum(["list", "add"] as const),  // Use StringEnum for Google
      text: Type.Optional(Type.String({ description: "Item text" })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] };

      // Stream progress (optional)
      onUpdate?.({ content: [{ type: "text", text: "Working..." }] });

      // Run shell commands
      const result = await pi.exec("some-command", ["--flag"], { signal });

      return {
        content: [{ type: "text", text: "Done: " + result.stdout }],
        details: { data: result.stdout },  // Available in renderResult & for state
      };
    },

    // Optional custom TUI rendering
    renderCall(args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("my_tool ")) + theme.fg("muted", args.action), 0, 0);
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Working..."), 0, 0);
      return new Text(theme.fg("success", "✓ Done"), 0, 0);
    },
  });
}
```

**Critical**: Use `StringEnum` (not `Type.Union`/`Type.Literal`) for string enums — Google's API breaks otherwise. Truncate output to avoid context overflow (see `references/api-cheatsheet.md`).

### 3 — Stateful extension with session reconstruction

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface MyState { items: string[]; }

export default function (pi: ExtensionAPI) {
  let state: MyState = { items: [] };

  // Reconstruct from session on every load/switch/fork/tree navigation
  const reconstruct = (ctx: ExtensionContext) => {
    state = { items: [] };
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "toolResult" && msg.toolName === "my_tool") {
        state = (msg.details as MyState) ?? state;
      }
    }
  };

  pi.on("session_start", async (_e, ctx) => reconstruct(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
  pi.on("session_fork",   async (_e, ctx) => reconstruct(ctx));
  pi.on("session_tree",   async (_e, ctx) => reconstruct(ctx));

  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Manages items",
    parameters: Type.Object({ item: Type.String() }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      state.items.push(params.item);
      return {
        content: [{ type: "text", text: "Added: " + params.item }],
        details: { items: [...state.items] } as MyState,  // Persist for reconstruction
      };
    },
  });
}
```

Key: store state in `details` of tool results (not in `appendEntry`) so branch navigation restores the correct snapshot.

---

### 4 — Bundling a companion skill with an extension (resources_discover)

Extensions can ship their own skills, prompt templates, and themes that auto-load alongside them:

```typescript
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths:  [join(baseDir, "skill/SKILL.md")],
    promptPaths: [join(baseDir, "prompts/my-prompt.md")],
    themePaths:  [join(baseDir, "themes/my-theme.json")],
  }));

  // ... register tools, commands, etc.
}
```

Key: use `dirname(fileURLToPath(import.meta.url))` for the extension's directory — `process.cwd()` would be the user's project, not the extension.

### 5 — bash-spawn-hook (wrap every bash call)

Override command/cwd/env for all bash executions — useful for profile sourcing, containerization, env injection:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashTool } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => ({
      command: `source ~/.nvm/nvm.sh && ${command}`,  // Ensure nvm is loaded
      cwd,
      env: { ...env, NODE_ENV: "development" },
    }),
  });

  pi.registerTool({
    ...bashTool,
    async execute(id, params, signal, onUpdate) {
      return bashTool.execute(id, params, signal, onUpdate);
    },
  });
}
```

---

## Generation Workflow

When asked to create an extension:

1. **Identify the primary capability**: event interception, custom tool, command, UI, or external integration
2. **Choose the right events**: see `rules/event-handlers.md` for which event to use and its return shape
3. **Scaffold**: single `.ts` for simple cases; `index.ts` directory for multi-file or when bundling resources
4. **Add state reconstruction** if the extension holds mutable state (see `rules/state-management.md`)
5. **Check `ctx.hasUI`** before any blocking UI method (`select`, `confirm`, `input`, `custom`)
6. **Truncate tool output** — mandatory for any tool that returns unbounded content
7. **Use `ctx.cwd` inside `execute`**, not `process.cwd()` — users can change directory mid-session
8. **Use `StringEnum`** (not `Type.Union`/`Type.Literal`) for all string enum parameters
9. **Bundle companion resources** with `resources_discover` if the extension ships skills or prompts
10. **Validate**: default export is a function, tool names are snake_case, all imports exist, no `Type.Literal` enums

## Fix Workflow

When asked to **debug, fix, or improve** an existing extension (errors, crashes, wrong behaviour, API misuse):

1. **Read the extension first** — understand what it's trying to do before touching anything
2. **Diagnose against the skill rules** — check each of the 10 generation rules above; most bugs fall into one of these categories:
   - Wrong import path or missing export (`default` function not exported)
   - `Type.Literal` / `Type.Union` used instead of `StringEnum` → breaks Google provider
   - `process.cwd()` used inside `execute` instead of `ctx.cwd`
   - UI method (`confirm`, `select`, `input`, `custom`) called without `ctx.hasUI` guard
   - State mutated in memory without session-reconstruction listeners → lost on fork/switch
   - Unbounded tool output returned without truncation → context overflow
   - `import.meta.url` missing when resolving companion skill/prompt paths
3. **Apply the minimal fix** — change only what is broken; preserve intent
4. **Verify** the fix against the reference files listed below if the API usage is non-obvious
5. **After the fix is done — update the skill** (see § Skill Self-Improvement below)

---

## Skill Self-Improvement

**Every time this skill is used, you MUST evaluate whether the skill files need updating.**

After delivering the result, examine what happened — mistakes, gaps, new patterns, or non-obvious lessons — and improve the skill:

**Where to put findings — you decide:**

1. **Existing file fits?** → Add to the most relevant `rules/*.md`, `references/*.md`, or `SKILL.md` section
2. **New concept that deserves its own rule?** → Create a new `rules/<rule-name>.md` following the Avoid/Prefer format (see `rules/_template.md`) and add it to the Reference Files list in `SKILL.md`
3. **New reference material (API details, patterns, examples)?** → Create a new `references/<name>.md` and add it to the Reference Files list in `SKILL.md`
4. **Core workflow change?** → Edit `SKILL.md` directly — update the relevant section or add a new one

**Guidelines:**
- Be concise — one bullet or ⚠️ **Gotcha:** callout per finding
- Don't duplicate — if the lesson is already documented, skip it
- New rule files: imperative title, explain why, then `## Avoid` / `## Prefer` with concrete examples
- After editing, briefly tell the user: *"I've also updated the skill with this finding so future sessions won't hit the same issue."*

---

## Reference Files

- `rules/event-handlers.md` — which event to use, return shapes, `resources_discover`, custom compaction with different model
- `rules/custom-tools.md` — tool registration, TypeBox, truncation, cwd-aware creation, `bash-spawn-hook`, typed built-in details
- `rules/state-management.md` — session reconstruction patterns and branch-safe state
- `rules/ui-interaction.md` — ctx.ui methods, hasUI checks, `SelectList`, `DynamicBorder`
- `references/api-cheatsheet.md` — complete ExtensionAPI reference: all events, ctx methods, CLI flags, shortcuts, LLM completion, file watcher
- `references/common-patterns.md` — 14 ready-to-copy templates: permission gate, stateful tool, inline-bash, file-trigger, project rules, preset system, bundled skill
