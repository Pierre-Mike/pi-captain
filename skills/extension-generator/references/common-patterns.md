# Common Extension Templates

Ready-to-copy complete extension templates for the most common use cases. Copy the closest template and adapt.

---

## 1 — Permission gate (confirm before dangerous commands)

```typescript
// ~/.pi/agent/extensions/permission-gate.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const patterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return undefined;

    const command = event.input.command;
    if (!patterns.some((p) => p.test(command))) return undefined;

    if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked (no UI)" };

    const ok = await ctx.ui.confirm("⚠️ Dangerous command", command);
    return ok ? undefined : { block: true, reason: "Blocked by user" };
  });
}
```

---

## 2 — Path protection (block writes to sensitive files)

```typescript
// ~/.pi/agent/extensions/protected-paths.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  const protected_ = [".env", ".env.local", "node_modules", ".git/config"];

  pi.on("tool_call", async (event, _ctx) => {
    if (!isToolCallEventType("write", event) && !isToolCallEventType("edit", event)) return;

    const filePath = event.input.path.replace(/^@/, ""); // Strip leading @ some models add
    const basename = path.basename(filePath);
    const isProtected = protected_.some((p) => filePath.includes(p) || basename === p);

    if (isProtected) {
      return { block: true, reason: `Write to protected path blocked: ${filePath}` };
    }
  });
}
```

---

## 3 — System prompt injector (per-turn context)

```typescript
// ~/.pi/agent/extensions/extra-context.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, _ctx) => {
    return {
      systemPrompt: event.systemPrompt + `\n\n## Extra Rules\nAlways respond in bullet points.`,
    };
  });
}
```

---

## 4 — Stateful tool (todo list, branch-aware)

```typescript
// ~/.pi/agent/extensions/todo.ts
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

interface Todo { id: number; text: string; done: boolean; }
interface TodoDetails { action: string; todos: Todo[]; nextId: number; error?: string; }

export default function (pi: ExtensionAPI) {
  let todos: Todo[] = [];
  let nextId = 1;

  const reconstruct = (ctx: ExtensionContext) => {
    todos = []; nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
      if (entry.message.toolName === "todo") {
        const d = entry.message.details as TodoDetails | undefined;
        if (d) { todos = d.todos; nextId = d.nextId; }
      }
    }
  };

  pi.on("session_start",  async (_e, ctx) => reconstruct(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
  pi.on("session_fork",   async (_e, ctx) => reconstruct(ctx));
  pi.on("session_tree",   async (_e, ctx) => reconstruct(ctx));

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description: "Manage todos. Actions: list, add (text required), toggle (id required), clear",
    parameters: Type.Object({
      action: StringEnum(["list", "add", "toggle", "clear"] as const),
      text: Type.Optional(Type.String({ description: "Text for add" })),
      id: Type.Optional(Type.Number({ description: "ID for toggle" })),
    }),
    async execute(_id, params) {
      if (params.action === "add") {
        if (!params.text) return { content: [{ type: "text", text: "Error: text required" }], isError: true };
        todos.push({ id: nextId++, text: params.text, done: false });
      } else if (params.action === "toggle") {
        const t = todos.find((t) => t.id === params.id);
        if (t) t.done = !t.done;
      } else if (params.action === "clear") {
        todos = []; nextId = 1;
      }
      const text = params.action === "list"
        ? todos.length ? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n") : "No todos"
        : `Done (${params.action})`;
      return {
        content: [{ type: "text", text }],
        details: { action: params.action, todos: [...todos], nextId } as TodoDetails,
      };
    },
    renderCall: (args, theme) => new Text(theme.fg("toolTitle", theme.bold("todo ")) + theme.fg("muted", args.action), 0, 0),
    renderResult: (result, { expanded }, theme) => {
      const d = result.details as TodoDetails | undefined;
      if (!d) return new Text("", 0, 0);
      let text = theme.fg("success", `✓ ${d.todos.length} todo(s)`);
      if (expanded) for (const t of d.todos) text += `\n${t.done ? "✓" : "○"} #${t.id} ${t.text}`;
      return new Text(text, 0, 0);
    },
  });

  pi.registerCommand("todos", {
    description: "Show current todos",
    handler: async (_args, ctx) => {
      const list = todos.length
        ? todos.map((t) => `${t.done ? "✓" : "○"} #${t.id}: ${t.text}`).join("\n")
        : "No todos.";
      ctx.ui.notify(list, "info");
    },
  });
}
```

---

## 5 — Tool with output truncation (search results)

```typescript
// ~/.pi/agent/extensions/smart-search.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "smart_search",
    label: "Smart Search",
    description: "Search for text in files using ripgrep with smart truncation",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex)" }),
      dir: Type.Optional(Type.String({ description: "Directory to search (default: cwd)" })),
    }),
    async execute(_id, params, signal) {
      const dir = params.dir || ctx?.cwd || ".";
      const { stdout, stderr, code } = await pi.exec("rg", [params.pattern, dir, "--line-number"], { signal });

      if (code !== 0 && !stdout.trim()) {
        return { content: [{ type: "text", text: stderr || "No matches found" }] };
      }

      const { content, truncated, totalLines, outputLines } = truncateHead(stdout, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });

      let text = content;
      if (truncated) {
        const tmp = path.join(os.tmpdir(), `pi-search-${Date.now()}.txt`);
        fs.writeFileSync(tmp, stdout);
        text += `\n\n[Truncated: ${outputLines}/${totalLines} lines shown. Full output: ${tmp}]`;
      }

      return { content: [{ type: "text", text }], details: { pattern: params.pattern, truncated } };
    },
  });
}
```

---

## 6 — Git checkpoint on each turn

```typescript
// ~/.pi/agent/extensions/git-checkpoint.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const checkpoints = new Map<string, string>(); // entryId → git stash ref
  let currentEntryId: string | undefined;

  pi.on("turn_start", async () => {
    const { stdout } = await pi.exec("git", ["stash", "create"]);
    const ref = stdout.trim();
    if (ref && currentEntryId) checkpoints.set(currentEntryId, ref);
  });

  pi.on("tool_result", async (_e, ctx) => {
    const leaf = ctx.sessionManager.getLeafEntry();
    if (leaf) currentEntryId = leaf.id;
  });

  pi.on("session_before_fork", async (event, ctx) => {
    const ref = checkpoints.get(event.entryId);
    if (!ref || !ctx.hasUI) return;
    const choice = await ctx.ui.select("Restore code to that checkpoint?", ["Yes", "No"]);
    if (choice === "Yes") {
      await pi.exec("git", ["stash", "apply", ref]);
      ctx.ui.notify("Code restored", "info");
    }
  });

  pi.on("agent_end", async () => checkpoints.clear());
}
```

---

## 7 — Footer status + widget panel

```typescript
// ~/.pi/agent/extensions/status-panel.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let turnCount = 0;

  pi.on("turn_start", async (_e, ctx) => {
    turnCount++;
    ctx.ui.setStatus("turns", `Turn ${turnCount}`);
    ctx.ui.setWidget("info", [`🔄 Turn ${turnCount} in progress...`]);
  });

  pi.on("turn_end", async (_e, ctx) => {
    ctx.ui.setWidget("info", undefined); // Clear widget when done
  });

  pi.on("session_shutdown", async (_e, ctx) => {
    ctx.ui.setStatus("turns", undefined);
  });
}
```

---

## 7b — Live streaming agent card widget

Shows a bordered card that updates on every streamed token, including thinking output.
Key rules: use `stream()` not `complete()`, use `visibleWidth()` not `.length` for ANSI strings,
and always `truncateToWidth` every line before returning from `render()`.

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { stream } from "@mariozechner/pi-ai";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

interface CardState {
  label: string;
  status: "running" | "done" | "error";
  elapsed: number;
  startTime: number;
  lastText: string;
  lastThinking: string;
  timer?: ReturnType<typeof setInterval>;
}

function renderCard(state: CardState, cardWidth: number, theme: any): string[] {
  const I = cardWidth - 2; // inner width

  function row(content: string, contentVisibleLen: number): string {
    const pad = Math.max(0, I - contentVisibleLen);
    return theme.fg("dim", "│") + content + " ".repeat(pad) + theme.fg("dim", "│");
  }

  const statusIcon = state.status === "running" ? "●" : state.status === "done" ? "✓" : "✗";
  const statusColor = state.status === "running" ? "accent" : state.status === "done" ? "success" : "error";
  const elapsedStr = `${Math.round(state.elapsed / 1000)}s`;

  // Track plain-text lengths for padding; apply theme.fg() separately (adds ANSI but no visible width)
  const nameRaw = state.label.slice(0, Math.max(4, I - 2 - (2 + state.status.length + 1 + elapsedStr.length)));
  const statusVisible = 2 + state.status.length + 1 + elapsedStr.length;
  // ⚠️  Subtract 1 for the leading space, or headerVisible will be I+1 and overflow by 1
  const headerPad = Math.max(1, I - 1 - nameRaw.length - statusVisible);
  const headerContent =
    " " + theme.fg("accent", theme.bold(nameRaw)) + " ".repeat(headerPad) +
    theme.fg(statusColor, `${statusIcon} ${state.status}`) + theme.fg("dim", ` ${elapsedStr}`);
  const headerVisible = Math.min(I, 1 + nameRaw.length + headerPad + statusVisible);

  const lines: string[] = [];
  lines.push(theme.fg("dim", "┌" + "─".repeat(I) + "┐"));
  lines.push(row(headerContent, headerVisible));

  if (state.lastThinking) {
    const prefix = " ~ ";
    const t = state.lastThinking.slice(0, I - prefix.length);
    lines.push(row(theme.fg("dim", prefix + t), prefix.length + t.length));
  }
  if (state.lastText) {
    const prefix = " > ";
    const t = state.lastText.slice(0, I - prefix.length);
    lines.push(row(theme.fg("muted", prefix + t), prefix.length + t.length));
  }

  lines.push(theme.fg("dim", "└" + "─".repeat(I) + "┘"));
  // Safety: hard-truncate every line to cardWidth visible chars
  return lines.map(l => truncateToWidth(l, cardWidth));
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("stream-demo", {
    description: "Run a streaming LLM call with a live card widget",
    handler: async (args, ctx) => {
      const task = args?.trim();
      if (!task) { ctx.ui.notify("Usage: /stream-demo <prompt>", "error"); return; }

      const state: CardState = {
        label: "assistant", status: "running",
        elapsed: 0, startTime: Date.now(), lastText: "", lastThinking: "",
      };

      const updateWidget = () => {
        ctx.ui.setWidget("stream-demo", (_tui, theme) => ({
          render(width: number): string[] {
            return renderCard(state, width, theme).map(l => truncateToWidth(l, width));
          },
          invalidate() {},
        }));
      };

      state.timer = setInterval(() => { state.elapsed = Date.now() - state.startTime; updateWidget(); }, 1000);

      const model = ctx.model;
      const apiKey = await ctx.modelRegistry.getApiKey(model);
      if (!apiKey) { ctx.ui.notify("No API key", "error"); return; }

      try {
        const eventStream = stream(
          model,
          { messages: [{ role: "user", content: [{ type: "text", text: task }], timestamp: Date.now() }] },
          { apiKey, maxTokens: 8192 },
        );

        let textBuffer = "";
        for await (const event of eventStream) {
          if (event.type === "text_delta") {
            textBuffer += event.delta;
            const lines = textBuffer.split("\n").filter(l => l.trim());
            state.lastText = lines[lines.length - 1] ?? "";
            updateWidget();
          } else if (event.type === "thinking_delta") {
            // Only fires on models with extended thinking
            const lines = (state.lastThinking + event.delta).split("\n").filter(l => l.trim());
            state.lastThinking = lines[lines.length - 1] ?? "";
            updateWidget();
          } else if (event.type === "error") {
            throw new Error(event.error.errorMessage ?? "LLM error");
          }
        }

        state.status = "done";
      } catch (err) {
        state.status = "error";
      } finally {
        clearInterval(state.timer);
        state.elapsed = Date.now() - state.startTime;
        updateWidget();
        setTimeout(() => ctx.ui.setWidget("stream-demo", undefined), 5000);
      }
    },
  });
}
```

---

## 8 — Custom slash command with waitForIdle

```typescript
// ~/.pi/agent/extensions/summarize-cmd.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("summarize-session", {
    description: "Summarize the current session and copy to clipboard",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();

      const entries = ctx.sessionManager.getBranch().length;
      const sessionFile = ctx.sessionManager.getSessionFile() ?? "ephemeral";

      ctx.ui.notify(`Session: ${entries} entries in ${sessionFile}`, "info");

      // Inject a message asking the LLM to summarize
      pi.sendUserMessage("Please provide a concise summary of what we've accomplished in this session.", {
        deliverAs: "followUp",
      });
    },
  });
}
```

---

## 9 — Model change indicator

```typescript
// ~/.pi/agent/extensions/model-status.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("model_select", async (event, ctx) => {
    const name = `${event.model.provider}/${event.model.id}`;
    ctx.ui.setStatus("model", `🤖 ${name}`);
    if (event.previousModel) {
      ctx.ui.notify(`Switched to ${name}`, "info");
    }
  });
}
```

---

## 10 — Inline bash expansion in user prompts (input transform)

Expands `!{command}` patterns in user prompts before they reach the LLM:

```typescript
// ~/.pi/agent/extensions/inline-bash.ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const PATTERN = /!\{([^}]+)\}/g;

  pi.on("input", async (event, ctx) => {
    // Don't touch whole-line !commands
    if (event.text.trimStart().startsWith("!") && !event.text.trimStart().startsWith("!{")) {
      return { action: "continue" };
    }

    if (!PATTERN.test(event.text)) return { action: "continue" };
    PATTERN.lastIndex = 0;

    // Collect all !{command} matches
    const matches: { full: string; command: string }[] = [];
    let match = PATTERN.exec(event.text);
    while (match) {
      matches.push({ full: match[0], command: match[1] });
      match = PATTERN.exec(event.text);
    }

    let result = event.text;
    const expansions: string[] = [];

    for (const { full, command } of matches) {
      try {
        const { stdout } = await pi.exec("bash", ["-c", command], { timeout: 30_000 });
        const output = stdout.trim();
        result = result.replace(full, output);
        expansions.push(`!{${command}} → "${output.slice(0, 50)}${output.length > 50 ? "..." : ""}"`);
      } catch (err) {
        result = result.replace(full, `[error: ${err instanceof Error ? err.message : String(err)}]`);
      }
    }

    if (ctx.hasUI && expansions.length > 0) {
      ctx.ui.notify(`Expanded ${expansions.length} command(s):\n${expansions.join("\n")}`, "info");
    }

    return { action: "transform", text: result, images: event.images };
  });
}
```

---

## 11 — External file-trigger integration

Watch a file and inject its content into the conversation when it changes (webhook bridge, CI integration):

```typescript
// ~/.pi/agent/extensions/file-trigger.ts
import * as fs from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const triggerFile = "/tmp/agent-trigger.txt";

    fs.watch(triggerFile, () => {
      try {
        const content = fs.readFileSync(triggerFile, "utf-8").trim();
        if (content) {
          pi.sendMessage(
            { customType: "file-trigger", content: `External trigger: ${content}`, display: true },
            { triggerTurn: true },  // Immediately get LLM to respond
          );
          fs.writeFileSync(triggerFile, ""); // Clear after reading
        }
      } catch { /* File may not exist yet */ }
    });

    if (ctx.hasUI) ctx.ui.notify(`Watching ${triggerFile} for triggers`, "info");
  });
}
```

Usage: `echo "Run the tests" > /tmp/agent-trigger.txt`

---

## 12 — Project-local rules injection (claude-rules style)

Scan a rules directory at startup and advertise files in the system prompt so the LLM loads relevant ones on demand:

```typescript
// ~/.pi/agent/extensions/project-rules.ts
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function findMarkdownFiles(dir: string, base = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) results.push(...findMarkdownFiles(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith(".md")) results.push(rel);
  }
  return results;
}

export default function (pi: ExtensionAPI) {
  let ruleFiles: string[] = [];

  pi.on("session_start", async (_e, ctx) => {
    ruleFiles = findMarkdownFiles(path.join(ctx.cwd, ".claude", "rules"));
    if (ruleFiles.length > 0 && ctx.hasUI) {
      ctx.ui.notify(`Found ${ruleFiles.length} project rule(s) in .claude/rules/`, "info");
    }
  });

  pi.on("before_agent_start", async (event) => {
    if (ruleFiles.length === 0) return;
    const list = ruleFiles.map((f) => `- .claude/rules/${f}`).join("\n");
    return {
      systemPrompt: event.systemPrompt +
        `\n\n## Project Rules\nThe following rules are available:\n${list}\nLoad relevant ones with the read tool before working on related tasks.`,
    };
  });
}
```

---

## 13 — Preset system with CLI flag, command, and shortcut

Load named presets from a JSON config, apply model/tools/thinking level, inject instructions per turn:

```typescript
// ~/.pi/agent/extensions/presets.ts
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

interface Preset {
  provider?: string; model?: string;
  thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools?: string[];
  instructions?: string;
}

function loadPresets(cwd: string): Record<string, Preset> {
  const load = (p: string): Record<string, Preset> => {
    try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : {}; } catch { return {}; }
  };
  // Project presets override global presets
  return { ...load(path.join(os.homedir(), ".pi", "agent", "presets.json")), ...load(path.join(cwd, ".pi", "presets.json")) };
}

export default function (pi: ExtensionAPI) {
  let presets: Record<string, Preset> = {};
  let activeName: string | undefined;
  let activePreset: Preset | undefined;

  pi.registerFlag("preset", { description: "Preset to activate on start", type: "string" });

  async function applyPreset(name: string, preset: Preset, ctx: ExtensionContext) {
    if (preset.provider && preset.model) {
      const model = ctx.modelRegistry.find(preset.provider, preset.model);
      if (model) await pi.setModel(model);
    }
    if (preset.thinkingLevel) pi.setThinkingLevel(preset.thinkingLevel);
    if (preset.tools?.length) pi.setActiveTools(preset.tools);
    activeName = name; activePreset = preset;
    ctx.ui.setStatus("preset", ctx.ui.theme.fg("accent", `preset:${name}`));
    ctx.ui.notify(`Preset "${name}" activated`, "info");
  }

  pi.registerCommand("preset", {
    description: "Switch active preset (usage: /preset <name>)",
    handler: async (args, ctx) => {
      const name = args?.trim();
      if (!name) {
        const names = Object.keys(presets).join(", ") || "(none)";
        ctx.ui.notify(`Available presets: ${names}\nActive: ${activeName ?? "none"}`, "info");
        return;
      }
      const preset = presets[name];
      if (!preset) { ctx.ui.notify(`Unknown preset "${name}"`, "error"); return; }
      await applyPreset(name, preset, ctx);
    },
  });

  pi.registerShortcut(Key.ctrlShift("u"), {
    description: "Cycle through presets",
    handler: async (ctx) => {
      const names = ["(none)", ...Object.keys(presets).sort()];
      const idx = names.indexOf(activeName ?? "(none)");
      const next = names[(idx + 1) % names.length];
      if (next === "(none)") {
        activeName = undefined; activePreset = undefined;
        pi.setActiveTools(["read", "bash", "edit", "write"]);
        ctx.ui.setStatus("preset", undefined);
        ctx.ui.notify("Preset cleared", "info");
      } else {
        await applyPreset(next, presets[next], ctx);
      }
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (activePreset?.instructions) {
      return { systemPrompt: `${event.systemPrompt}\n\n${activePreset.instructions}` };
    }
  });

  pi.on("session_start", async (_e, ctx) => {
    presets = loadPresets(ctx.cwd);
    const flagValue = pi.getFlag("preset");
    if (typeof flagValue === "string" && flagValue && presets[flagValue]) {
      await applyPreset(flagValue, presets[flagValue], ctx);
    }
  });
}
```

---

## 15 — Free-text input dialog (Editor-based, the canonical pattern)

Use this whenever a command needs to ask the user to type something. Copy `makeTaskInput` and adapt the title/hint text. Do **not** use `Input` directly (see `rules/ui-interaction.md` for why).

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

// Reusable factory — returns a { render, invalidate, handleInput } object
// ready to be returned from a ctx.ui.custom factory callback.
function makeTextInputDialog(
  title: string,
  hint: string,
  tui: any,
  theme: any,
  done: (value: string | null) => void,
) {
  let cachedLines: string[] | undefined;

  const editorTheme: EditorTheme = {
    borderColor: (s: string) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t: string) => theme.fg("accent", t),
      selectedText:   (t: string) => theme.fg("accent", t),
      description:    (t: string) => theme.fg("muted",  t),
      scrollInfo:     (t: string) => theme.fg("dim",    t),
      noMatch:        (t: string) => theme.fg("warning", t),
    },
  };

  const editor = new Editor(tui, editorTheme);
  editor.onSubmit = (value) => {
    const trimmed = value.trim();
    done(trimmed.length > 0 ? trimmed : null);
  };

  return {
    render(width: number): string[] {
      if (cachedLines) return cachedLines;
      const lines: string[] = [];
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      add(theme.fg("accent", "─".repeat(width)));
      add(theme.fg("accent", theme.bold(`  ✎  ${title}`)));
      if (hint) add(theme.fg("dim", `  ${hint}`));
      lines.push("");
      for (const line of editor.render(width - 4)) add(`  ${line}`);
      lines.push("");
      add(theme.fg("dim", "  Enter to confirm  •  Esc to cancel"));
      add(theme.fg("accent", "─".repeat(width)));
      cachedLines = lines;
      return lines;
    },
    invalidate() { cachedLines = undefined; },
    handleInput(data: string) {
      if (matchesKey(data, Key.escape)) { done(null); return; }
      editor.handleInput(data);
      cachedLines = undefined;
      tui.requestRender();
    },
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("ask", {
    description: "Ask the user to type something",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;

      const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) =>
        makeTextInputDialog("What's your name?", "Type your answer below…", tui, theme, done),
      );

      if (result === null) {
        ctx.ui.notify("Cancelled.", "info");
      } else {
        ctx.ui.notify(`You typed: "${result}"`, "info");
      }
    },
  });
}
```

---

## 14 — Extension that bundles a companion skill (resources_discover)

Ship a skill alongside your extension so it auto-loads without manual placement:

```typescript
// ~/.pi/agent/extensions/my-tool-with-skill/index.ts
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const baseDir = dirname(fileURLToPath(import.meta.url));

export default function (pi: ExtensionAPI) {
  // Expose a companion skill from this extension's directory
  pi.on("resources_discover", () => ({
    skillPaths:  [join(baseDir, "skill/SKILL.md")],
    promptPaths: [join(baseDir, "prompts/deploy.md")],
  }));

  // The actual tool
  pi.registerTool({
    name: "my_custom_tool",
    label: "My Custom Tool",
    description: "Does something specialized. See skill:my-skill for workflows.",
    parameters: Type.Object({ input: Type.String() }),
    async execute(_id, params, _signal) {
      return { content: [{ type: "text", text: `Processed: ${params.input}` }] };
    },
  });
}
```

Directory layout:
```
my-tool-with-skill/
├── index.ts       ← Extension entry point
├── skill/
│   └── SKILL.md   ← Bundled skill (name, description, instructions)
└── prompts/
    └── deploy.md  ← Bundled prompt template
```

---

## 15 — Accessing pi's internal dependencies (e.g. `@mariozechner/jiti`)

Extensions can't directly import packages that live in pi's `node_modules` (like `@mariozechner/jiti`).
Use `createRequire` pointed at pi's package to resolve them:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

function resolvePiDep(dep: string): unknown {
  // Works inside pi's process at runtime
  try {
    return createRequire(
      require.resolve("@mariozechner/pi-coding-agent/package.json"),
    )(dep);
  } catch {
    // Fallback: resolve via the `pi` binary symlink
    const piReal = fs.realpathSync(path.resolve("/opt/homebrew/bin/pi"));
    const piPkg = path.join(path.dirname(piReal), "..", "package.json");
    return createRequire(piPkg)(dep);
  }
}

// Example: get jiti
const { createJiti } = resolvePiDep("@mariozechner/jiti") as {
  createJiti: (url: string) => (id: string) => unknown;
};
const jiti = createJiti(import.meta.url);
```
