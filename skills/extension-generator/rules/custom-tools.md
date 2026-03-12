# Register tools with correct schemas, truncation, and optional rendering

Tools registered via `pi.registerTool()` appear in the LLM's system prompt and can be called like built-in tools. Three common mistakes: using `Type.Union`/`Type.Literal` for enums (breaks Google), forgetting output truncation (causes context overflow), and returning `details` without the right shape for rendering.

⚠️ **Gotcha:** When using `String.repeat(n)`, always clamp `n` to `>= 0`. Values derived from API responses (e.g. `ctx.getContextUsage()`) can produce negative counts and crash with `Invalid count value`.

## Avoid

```typescript
// Wrong: Type.Union for string enums — Google's API chokes on this
parameters: Type.Object({
  action: Type.Union([Type.Literal("list"), Type.Literal("add")]),
}),

// Wrong: no truncation on potentially large output
async execute(_id, params, _signal) {
  const output = await pi.exec("find", ["/", "-name", "*.ts"]);
  return { content: [{ type: "text", text: output.stdout }] }; // Could be megabytes
}

// Wrong: mutable details object (causes shared-reference bugs when branching)
return { content: [...], details: state }; // state is mutated later
```

## Prefer

### Correct enum parameter with StringEnum

```typescript
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";

parameters: Type.Object({
  action: StringEnum(["list", "add", "toggle", "clear"] as const),
  text: Type.Optional(Type.String({ description: "Text for add action" })),
  id: Type.Optional(Type.Number({ description: "Item ID for toggle" })),
}),
```

### Truncate output — required for any large or unbounded result

```typescript
import { truncateHead, truncateTail, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async execute(_id, params, signal) {
  const { stdout } = await pi.exec("rg", [params.pattern, params.dir], { signal });

  const { content, truncated, totalLines, outputLines, totalBytes, outputBytes } = truncateHead(stdout, {
    maxLines: DEFAULT_MAX_LINES,  // 2000
    maxBytes: DEFAULT_MAX_BYTES,  // 50KB
  });

  let text = content;

  if (truncated) {
    // Save full output to temp file so LLM can read it with the read tool
    const tmp = path.join(os.tmpdir(), `pi-tool-${Date.now()}.txt`);
    fs.writeFileSync(tmp, stdout);
    text += `\n\n[Truncated: ${outputLines}/${totalLines} lines shown. Full output: ${tmp}]`;
  }

  return { content: [{ type: "text", text }] };
},
```

Use `truncateTail` when the end of output matters more (logs, command output). Use `truncateHead` when the beginning matters (search results, file reads).

### Immutable details snapshot for state tools

```typescript
// Always spread arrays/objects — never pass mutable references
return {
  content: [{ type: "text", text: "Added item" }],
  details: { items: [...state.items], nextId: state.nextId }, // Snapshot, not reference
};
```

### Custom rendering for polished TUI output

```typescript
import { Text } from "@mariozechner/pi-tui";

renderCall(args, theme) {
  let text = theme.fg("toolTitle", theme.bold("search "));
  text += theme.fg("accent", args.pattern);
  if (args.dir) text += theme.fg("dim", ` in ${args.dir}`);
  return new Text(text, 0, 0); // Always (0, 0) padding — Box handles it
},

renderResult(result, { expanded, isPartial }, theme) {
  if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);

  const details = result.details as { count: number; matches: string[] } | undefined;
  if (!details) return new Text(theme.fg("error", "No details"), 0, 0);

  let text = theme.fg("success", `✓ ${details.count} match(es)`);

  if (expanded) {
    for (const m of details.matches) {
      text += "\n  " + theme.fg("dim", m);
    }
  } else if (details.matches.length > 0) {
    text += theme.fg("dim", ` (expand to see matches)`);
  }

  return new Text(text, 0, 0);
},
```

Rendering is optional. Without it, pi falls back to tool name for `renderCall` and raw content text for `renderResult`.

### Overriding a built-in tool (read, bash, write, edit)

Register with the same `name` as the built-in. Pi shows a warning in interactive mode. Your implementation **must** match the original tool's `details` shape exactly — the UI and session reconstruction depend on it.

**Critical: use `ctx.cwd` (not `process.cwd()`) inside `execute`** so the tool works correctly when the user changes directory. Cache instances by cwd to avoid re-creating on every call:

```typescript
import { createReadTool, createBashTool } from "@mariozechner/pi-coding-agent";

const toolCache = new Map<string, ReturnType<typeof createReadTool>>();

function getReadTool(cwd: string) {
  if (!toolCache.has(cwd)) toolCache.set(cwd, createReadTool(cwd));
  return toolCache.get(cwd)!;
}

export default function (pi: ExtensionAPI) {
  const baseRead = createReadTool(process.cwd()); // For parameters/description only

  pi.registerTool({
    ...baseRead,  // Inherit name, label, description, parameters, renderCall, renderResult
    async execute(id, params, signal, onUpdate, ctx) {
      console.log(`[audit] read: ${params.path}`);
      return getReadTool(ctx.cwd).execute(id, params, signal, onUpdate);
    },
  });
}
```

### Accessing typed built-in tool details in renderResult

Built-in tools expose typed details — use them for rich rendering (e.g., diff stats, truncation info):

```typescript
import type { ReadToolDetails, BashToolDetails, EditToolDetails } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

// In a read tool override:
renderResult(result, { expanded, isPartial }, theme) {
  if (isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);
  const details = result.details as ReadToolDetails | undefined;
  const content = result.content[0];
  if (content?.type !== "text") return new Text("", 0, 0);
  const lineCount = content.text.split("\n").length;
  let text = theme.fg("success", `${lineCount} lines`);
  if (details?.truncation?.truncated) {
    text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
  }
  return new Text(text, 0, 0);
},

// In an edit tool override — show diff stats:
renderResult(result, { expanded, isPartial }, theme) {
  if (isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);
  const details = result.details as EditToolDetails | undefined;
  if (!details?.diff) return new Text(theme.fg("success", "Applied"), 0, 0);
  const lines = details.diff.split("\n");
  const additions = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removals  = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  return new Text(theme.fg("success", `+${additions}`) + theme.fg("dim", " / ") + theme.fg("error", `-${removals}`), 0, 0);
},
```

### bash-spawn-hook — adjust command, cwd, or env before execution

Use `createBashTool` with a `spawnHook` to wrap every bash command (e.g., source a profile, set env vars, redirect to a container):

```typescript
import { createBashTool } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const bashTool = createBashTool(process.cwd(), {
    spawnHook: ({ command, cwd, env }) => ({
      command: `source ~/.profile && ${command}`,   // Ensure profile is loaded
      cwd,
      env: { ...env, MY_VAR: "1" },
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

### Multi-tool extension with shared state

```typescript
export default function (pi: ExtensionAPI) {
  let connection: MyConnection | null = null;

  pi.registerTool({ name: "db_connect", ..., async execute(...) {
    connection = await connect(params.url);
    return { content: [{ type: "text", text: "Connected" }] };
  }});

  pi.registerTool({ name: "db_query", ..., async execute(id, params, signal) {
    if (!connection) return { content: [{ type: "text", text: "Error: not connected" }], isError: true };
    const rows = await connection.query(params.sql);
    return { content: [{ type: "text", text: JSON.stringify(rows) }] };
  }});

  pi.on("session_shutdown", async () => { connection?.close(); });
}
```
