# Check ctx.hasUI before any UI method and choose the right UI primitive

`ctx.ui` provides rich interaction, but some methods are no-ops or unavailable in print mode (`-p`) and JSON mode. Always gate blocking UI calls behind `ctx.hasUI`. Non-blocking fire-and-forget methods (`notify`, `setStatus`, `setWidget`) are safe to call unconditionally — they become no-ops.

## Avoid

```typescript
// Wrong: blocking UI in non-interactive mode causes hang or crash
pi.on("tool_call", async (event, ctx) => {
  if (isDangerous(event)) {
    const ok = await ctx.ui.confirm("Allow?", "Description"); // Hangs in -p mode
    if (!ok) return { block: true, reason: "Blocked" };
  }
});

// Wrong: select() in a tool's execute() — tools cannot use blocking UI
pi.registerTool({
  ...,
  async execute(_id, params, _signal, _onUpdate, ctx) {
    const choice = await ctx.ui.select("Pick:", ["A", "B"]); // Works, but discouraged
    // select/confirm/input in tools is OK but unusual; registerCommand is better for user-driven workflows
  }
});
```

## Prefer

### Gate blocking calls behind ctx.hasUI

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (isDangerous(event)) {
    if (!ctx.hasUI) return { block: true, reason: "Blocked (no UI for confirmation)" };
    const ok = await ctx.ui.confirm("⚠️ Dangerous", event.input.command);
    if (!ok) return { block: true, reason: "Blocked by user" };
  }
});
```

### Quick reference — which method for which need

| Need | Method | Blocks? | Safe without hasUI? |
|------|--------|---------|---------------------|
| Non-blocking toast | `ctx.ui.notify(msg, level)` | No | ✅ Yes (no-op) |
| Footer status text | `ctx.ui.setStatus(key, text)` | No | ✅ Yes (no-op) |
| Widget above/below editor | `ctx.ui.setWidget(key, lines)` | No | ✅ Yes (no-op) |
| Pick one from list | `ctx.ui.select(title, options[])` | Yes | ❌ Check hasUI |
| Yes/No confirmation | `ctx.ui.confirm(title, body)` | Yes | ❌ Check hasUI |
| Free-text input | `ctx.ui.input(label, placeholder?)` | Yes | ❌ Check hasUI |
| Multi-line editor | `ctx.ui.editor(label, prefill?)` | Yes | ❌ Check hasUI |
| Full custom component | `ctx.ui.custom(factory)` | Yes | ❌ Check hasUI |

### Timed dialogs (auto-dismiss)

```typescript
const ok = await ctx.ui.confirm("Confirm deploy?", "Deploying to prod in 10s", { timeout: 10_000 });
// Returns false on timeout
```

### setStatus — persistent footer indicator

```typescript
pi.on("turn_start", async (_e, ctx) => {
  ctx.ui.setStatus("my-ext", "🔄 Turn running");
});
pi.on("turn_end", async (_e, ctx) => {
  ctx.ui.setStatus("my-ext", undefined); // Clear
});
```

### setWidget — info panel above editor

`setWidget` accepts either a plain string array (static) or a **render function** (dynamic, width-aware). Always prefer the render function when content depends on terminal width or contains ANSI codes:

```typescript
// ── Static (simple cases) ─────────────────────────────────────────────────
pi.on("agent_start", async (_e, ctx) => {
  ctx.ui.setWidget("my-ext", ["🚀 Agent started", `Entries: ${ctx.sessionManager.getBranch().length}`]);
});
pi.on("agent_end", async (_e, ctx) => {
  ctx.ui.setWidget("my-ext", undefined); // Clear
});

// ── Dynamic render function (live streaming, cards, ANSI content) ─────────
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

// Call this whenever underlying state changes (every token, every tick, etc.)
function updateWidget(ctx, state) {
  ctx.ui.setWidget("my-ext", (_tui, theme) => ({
    render(width: number): string[] {
      const lines: string[] = [];
      lines.push(theme.fg("accent", `Status: ${state.label}`));
      lines.push(theme.fg("dim", `Elapsed: ${state.elapsed}s`));
      // MANDATORY: truncate every line to terminal width before returning
      return lines.map(l => truncateToWidth(l, width));
    },
    invalidate() {},   // Called by pi to clear render caches; leave empty if not using Text/Container
  }));
}
```

#### ⚠️ TUI width rule — every line must be ≤ terminal width

The TUI throws a hard crash if any rendered line exceeds the terminal width:
```
Error: Rendered line N exceeds terminal width (107 > 106).
This is likely caused by a custom TUI component not truncating its output.
Use visibleWidth() to measure and truncateToWidth() to truncate lines.
```

**Rules to follow:**

1. **Never use `.length` on ANSI-decorated strings** — ANSI escape codes add bytes but no visible width. A string coloured with `theme.fg()` will have `.length` much larger than its visible width.

2. **Use `visibleWidth(str)` to measure** and **`truncateToWidth(str, maxWidth)` to truncate** — both from `@mariozechner/pi-tui`, both ANSI-aware.

3. **When computing padding manually**, track the *visible* size of each segment:
   ```typescript
   import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

   // ✅ Correct — track visible sizes separately from ANSI-decorated strings
   const label = "Architecture Scout";          // plain, .length is accurate
   const labelStr = theme.fg("accent", theme.bold(label));  // ANSI-decorated
   const statusRaw = "● running 5s";            // plain
   const statusStr = theme.fg("accent", statusRaw);

   // Padding = inner width - 1 (leading space) - label length - status length
   const pad = Math.max(1, innerWidth - 1 - label.length - statusRaw.length);
   const content = " " + labelStr + " ".repeat(pad) + statusStr;
   // visible size of content = 1 + label.length + pad + statusRaw.length = innerWidth ✓

   // ✅ Always add a safety truncation pass at the end
   return lines.map(l => truncateToWidth(l, width));
   ```

4. **Common pitfall — forgetting a leading/trailing space in the count:**
   ```typescript
   // ❌ Bug: headerPad doesn't subtract the leading space → overflows by 1
   const headerPad = Math.max(1, I - nameLen - statusLen);

   // ✅ Fix: subtract 1 for the leading space character
   const headerPad = Math.max(1, I - 1 - nameLen - statusLen);
   ```

5. **Parallel / side-by-side cards** — when rendering multiple cards next to each other, compute each card width with floor division and verify the total fits:
   ```typescript
   const gap = 1;
   const cardWidth = Math.floor((width - gap * (cols - 1)) / cols);
   // Total visible = cols * cardWidth + gap * (cols-1) ≤ width  ✓
   ```

### ⚠️ Prefer `Editor` over `Input` for free-text dialogs in `ctx.ui.custom`

When building a custom text-input dialog with `ctx.ui.custom`, always use `Editor` (not `Input`) for free-text entry. The `Editor`-based closure pattern is simpler, works reliably out of the box, and matches the approach used in working extensions.

```typescript
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
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
      add(theme.fg("accent", theme.bold("  ✎  Type something")));
      lines.push("");
      for (const line of editor.render(width - 4)) add(`  ${line}`);
      lines.push("");
      add(theme.fg("dim", "  Enter to submit  •  Esc to cancel"));
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
});
```

**Why `Editor` and not `Input` for this pattern:**

| | `Editor` | `Input` |
|---|---|---|
| `onSubmit` fires on Enter | ✅ Yes | ✅ Yes |
| Escape handling | ✅ `matchesKey(data, Key.escape)` in `handleInput` | ⚠️ Requires setting `input.onEscape` separately — pressing Escape calls `onEscape`, NOT `onSubmit` |
| `tui.requestRender()` needed | ✅ Called in `handleInput` closure | ⚠️ Must also be called explicitly — without it keystrokes are silently swallowed and the UI freezes |
| Multi-line support | ✅ Yes | ❌ Single line only |

**If you must use `Input` directly**, remember these two mandatory steps:
```typescript
const input = new Input();
input.onSubmit = (value) => done(value.trim() || null);
input.onEscape = () => done(null);  // ⚠️ REQUIRED — Escape calls onEscape, not onSubmit

// In handleInput:
handleInput(data: string) {
  input.handleInput(data);
  tui.requestRender();  // ⚠️ REQUIRED — without this the UI freezes while typing
}
```

### Custom component (ctx.ui.custom) — interactive dialog

```typescript
import { Text } from "@mariozechner/pi-tui";

const result = await ctx.ui.custom<string | null>((_tui, theme, _kb, done) => {
  const lines = ["Options:", "  [1] Option A", "  [2] Option B", "  [Esc] Cancel"];
  const text = new Text(lines.join("\n"), 1, 1);

  text.onKey = (key) => {
    if (key === "1") done("A");
    if (key === "2") done("B");
    if (key === "escape") done(null);
    return true; // Consume the key
  };

  return text;
});

if (result === null) {
  ctx.ui.notify("Cancelled", "info");
}
```

Use `ctx.ui.custom` only in `registerCommand` handlers or event handlers — not in `execute()` of a registered tool unless truly necessary. Complex interactive workflows belong in commands, not tools.

---

### ⚠️ Never chain two `ctx.ui.custom` (or `ctx.ui.input`) calls back-to-back

Calling a second `ctx.ui.custom` or `ctx.ui.input` immediately after a first one resolves leaves the TUI in a broken focus state — the new input box appears but keystrokes are silently dropped.

```typescript
// ❌ Bug: second custom/input call doesn't receive keyboard input
const chosen = await showSelectorDialog(ctx);   // ctx.ui.custom inside
if (!chosen) return;
const typed = await ctx.ui.input("Task", "…"); // focus is broken — user can't type
```

**Fix: keep all phases inside a single `ctx.ui.custom` call.** Use a mutable `phase` variable to switch what is rendered and which child handles input:

```typescript
import { getEditorKeybindings, Input, SelectList } from "@mariozechner/pi-tui";

// ✅ Both select and input phases live in one ctx.ui.custom session
const result = await ctx.ui.custom<{ name: string; task: string } | null>(
  (tui, theme, _kb, done) => {
    type Phase = "select" | "input";
    let phase: Phase = "select";
    let selectedName = "";

    // Phase 1 — SelectList
    const selectList = new SelectList(items, 10, { /* theme callbacks */ });
    selectList.onCancel = () => done(null);
    selectList.onSelect = (item) => {
      selectedName = item.value;
      phase = "input";
      taskInput.focused = component.focused; // propagate focus before re-render
      // Do NOT call tui.requestRender() here — the TUI calls it automatically
      // after component.handleInput() returns (our current caller).
    };

    // Phase 2 — Input
    // ⚠️  Do NOT set taskInput.onSubmit / taskInput.onEscape.
    // Calling done() from inside taskInput.handleInput() while still nested in
    // the TUI's input-dispatch chain causes rendering/focus breakage.
    // Instead, intercept Enter and Escape at the component.handleInput level
    // (the ExtensionInputComponent pattern — see handleInput below).
    const taskInput = new Input();

    // Focusable: always forward to taskInput regardless of phase, so the TUI's
    // initial setFocus() call is also propagated correctly.
    let _focused = false;
    const component = {
      get focused() { return _focused; },
      set focused(v: boolean) {
        _focused = v;
        taskInput.focused = v; // always propagate — not just in input phase
      },
      render(w: number): string[] {
        if (phase === "select") return selectContainer.render(w);
        // iw: Input gets (w - 3) so that │ + space + input + │ = w exactly.
        const iw = Math.max(4, w - 3);
        const inputLine = taskInput.render(iw)[0] ?? "";
        return [
          // ... title/description/separator rows ...
          theme.fg("accent", "│") + " " + inputLine + theme.fg("accent", "│"),
          // ... hint/bottom-border rows ...
        ];
      },
      invalidate() { selectContainer.invalidate(); taskInput.invalidate(); },
      // Mirror ExtensionInputComponent exactly:
      //   Enter  → submit  (empty → cancel)
      //   Escape → cancel
      //   other  → taskInput.handleInput()
      // Do NOT call tui.requestRender() — the TUI does it after handleInput returns.
      handleInput(data: string) {
        if (phase === "select") {
          selectList.handleInput(data);
          return;
        }
        const kb = getEditorKeybindings();
        if (kb.matches(data, "selectConfirm") || data === "\n") {
          const trimmed = taskInput.getValue().trim();
          if (trimmed) done({ name: selectedName, task: trimmed });
          else done(null);
        } else if (kb.matches(data, "selectCancel")) {
          done(null);
        } else {
          taskInput.handleInput(data);
        }
      },
    };
    return component;
  }
);
```

---

### Focusable — required when a custom component contains an `Input` or `Editor`

If the object returned from the `ctx.ui.custom` factory contains an `Input` (or `Editor`) child, the **returned object itself must implement the `Focusable` interface** and forward `focused` to that child. Without it the hardware cursor is not positioned correctly and the user cannot type (even without an IME).

`Focusable` is just a `focused: boolean` getter/setter pair:

```typescript
import { Input } from "@mariozechner/pi-tui";

const taskInput = new Input();
let _focused = false;

const component = {
  // ── Focusable ──────────────────────────────────────────────────────────
  get focused(): boolean { return _focused; },
  set focused(v: boolean) {
    _focused = v;
    taskInput.focused = v;   // must propagate to every Input/Editor child
  },

  // ── Component ──────────────────────────────────────────────────────────
  render(w: number): string[] { return taskInput.render(w); },
  invalidate() { taskInput.invalidate(); },
  handleInput(data: string) { taskInput.handleInput(data); tui.requestRender(); },
};
```

When a `Container` wraps the `Input`, apply the same propagation pattern on the container class (see tui.md → "Container Components with Embedded Inputs").
