# Store state in tool result details for branch-safe reconstruction

Extensions with mutable state must reconstruct it from the session on every load, switch, fork, and tree navigation. Storing state in tool result `details` (not `appendEntry` or external files) automatically gives you branch-correct history: when the user navigates to a different point in the conversation tree, the state reconstructed from that branch's tool results is exactly right.

## Avoid

```typescript
// Wrong: state in a file — not branch-aware, persists across forks incorrectly
export default function (pi: ExtensionAPI) {
  let items: string[] = JSON.parse(fs.readFileSync(".state.json", "utf8"));

  pi.registerTool({ name: "add_item", ..., async execute(_, params) {
    items.push(params.item);
    fs.writeFileSync(".state.json", JSON.stringify(items));
    return { content: [{ type: "text", text: "Added" }] };
  }});
}

// Wrong: using appendEntry for tool state — not tied to the message graph
pi.appendEntry("my-state", { items });  // Survives /fork in the wrong branch
```

## Prefer

### Full reconstruction pattern

```typescript
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

interface Item { id: number; text: string; }
interface MyDetails { items: Item[]; nextId: number; }

export default function (pi: ExtensionAPI) {
  let items: Item[] = [];
  let nextId = 1;

  // Called after every session event that changes which branch we're on
  const reconstruct = (ctx: ExtensionContext) => {
    items = [];
    nextId = 1;
    // getBranch() returns entries from root to current leaf, in order
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role === "toolResult" && msg.toolName === "my_tool") {
        const d = msg.details as MyDetails | undefined;
        if (d) { items = d.items; nextId = d.nextId; }
      }
    }
  };

  // Hook every session event that changes the branch
  pi.on("session_start",  async (_e, ctx) => reconstruct(ctx));
  pi.on("session_switch", async (_e, ctx) => reconstruct(ctx));
  pi.on("session_fork",   async (_e, ctx) => reconstruct(ctx));
  pi.on("session_tree",   async (_e, ctx) => reconstruct(ctx));

  pi.registerTool({
    name: "my_tool",
    label: "My Tool",
    description: "Manages items",
    parameters: Type.Object({ action: Type.String(), text: Type.Optional(Type.String()) }),

    async execute(_id, params, _signal, _onUpdate, _ctx) {
      if (params.action === "add" && params.text) {
        items.push({ id: nextId++, text: params.text });
      }
      // Return a SNAPSHOT (not a reference) so future mutations don't corrupt history
      return {
        content: [{ type: "text", text: `Items: ${items.length}` }],
        details: { items: [...items], nextId } as MyDetails,
      };
    },
  });
}
```

### When appendEntry IS appropriate

Use `pi.appendEntry` only for extension metadata that is NOT tool output and does NOT need to vary by branch — e.g., recording that the user accepted a license, storing a session name, or saving audit logs.

```typescript
// OK: audit log — not state that needs branch-correct reconstruction
pi.on("tool_call", async (event) => {
  pi.appendEntry("audit-log", { tool: event.toolName, ts: Date.now() });
});

// NOT OK: tool state — use tool result details instead
pi.appendEntry("my-tool-state", { items }); // Don't do this for tool state
```

### Reconstructing from multiple tool types

If your extension has several tools that all contribute to shared state, reconstruct from all of them:

```typescript
const reconstruct = (ctx: ExtensionContext) => {
  state = initialState();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message" || entry.message.role !== "toolResult") continue;
    const msg = entry.message;
    if (msg.toolName === "db_connect")    applyConnect(msg.details);
    if (msg.toolName === "db_disconnect") applyDisconnect(msg.details);
  }
};
```
