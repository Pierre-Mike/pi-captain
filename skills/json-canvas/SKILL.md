---
name: json-canvas
description: >
  JSON Canvas format for creating and editing Obsidian .canvas files
  programmatically. Covers text, group, file, and link node types; edge
  connections with side references; unique ID generation; color presets;
  and layout strategies. Use when working with any .canvas file: creating
  diagrams, flowcharts, mind maps, or kanban boards; adding/removing nodes
  while preserving IDs; positioning nodes inside groups; wiring edges with
  correct fromSide/toSide values; applying color presets for visual hierarchy;
  or generating canvas files programmatically via the generation script.
---

# JSON Canvas

## Two-Pass Architecture

This skill uses a **two-pass approach** for canvas generation:

1. **You decide** (semantic): what nodes to create, their content, which layout strategy to use, color assignments, and group membership. Output a lightweight intermediate JSON.
2. **The script computes** (deterministic): unique hex IDs, pixel coordinates from the chosen layout algorithm, group bounds from children, node sizes from content length, edge sides from relative positions, z-index ordering. Run `scripts/generate-canvas.py`.

For simple canvases (< 5 nodes), you can skip the script and write `.canvas` JSON directly using the spec below. For anything larger, always use the script.

### Intermediate Format

Pass this JSON to `scripts/generate-canvas.py`:

```json
{
  "layout": "grid",
  "nodes": [
    { "content": "## Module A\n\nHandles auth and sessions", "color": "4" },
    { "content": "## Module B\n\nHandles data processing", "color": "5" },
    { "content": "## Shared Utils\n\nUsed by both modules", "color": "6" }
  ],
  "edges": [
    { "from": 0, "to": 2, "label": "imports" },
    { "from": 1, "to": 2, "label": "imports" }
  ]
}
```

The script outputs valid `.canvas` JSON with computed IDs, coordinates, sizing, and edge routing. See `scripts/generate-canvas.py --help` for all options.

### Intermediate Format Reference

**Node fields**: `content` (string, required), `type` (text|group|file|link, default "text"), `color` ("1"-"6" or hex), `group` (index of parent group node), `file` (vault path for file nodes), `url` (for link nodes), `label` (for group nodes), `width`/`height` (override auto-sizing).

**Edge fields**: `from` (node index), `to` (node index), `label` (optional annotation), `bidirectional` (boolean, adds arrows on both ends).

**Layout options**: `"grid"`, `"tree"`, `"layered"`, `"radial"`, `"manual"`. See `rules/choose-layout-strategy.md`.

**Top-level options**: `layout` (string), `direction` ("TB"|"BT"|"LR"|"RL", default "TB"), `spacing` (number, override default gaps).


## Core Concepts

**Canvas Structure**: A .canvas file is JSON with two top-level arrays: `nodes` and `edges`. Nodes are ordered by z-index -- first node renders at the bottom, last at the top. Place group nodes before their children so children render on top.

```json
{
  "nodes": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "group", "x": -220, "y": -20, "width": 440, "height": 340, "color": "4", "label": "MY GROUP" },
    { "id": "c3d4e5f6g7h8i9j0", "type": "text", "x": -200, "y": 10, "width": 400, "height": 280, "text": "## Content\n\nInside the group" }
  ],
  "edges": [
    { "id": "e1f2a3b4c5d6e7f8", "fromNode": "c3d4e5f6g7h8i9j0", "toNode": "d4e5f6g7h8i9j0k1", "toEnd": "arrow" }
  ]
}
```

**Node Types**: `text` (markdown content, most common), `group` (visual container with `label`, optional `background`/`backgroundStyle`), `file` (vault-relative path via `file` property, optional `subpath`), `link` (URL via `url` property).

**Color Presets**: Numeric strings `"1"` through `"6"` map to actual colors. Hex strings (e.g., `"#FF0000"`) are also valid.

| Preset | Color | Suggested use |
|--------|-------|---------------|
| `"1"` | Red | Titles, headers, warnings |
| `"2"` | Orange | Commands, actions, processes |
| `"3"` | Yellow | Outputs, highlights, notes |
| `"4"` | Green | Module groups, success states |
| `"5"` | Cyan | Secondary modules, data flows |
| `"6"` | Purple | Shared layers, abstractions |

Assign colors by semantic role, not arbitrarily. Use `## Title` (not `# Title`) in text nodes -- `#` renders very large and wastes vertical space.

**⚠ Code Block Content Must Be ASCII-Only**: Unicode characters (em dash `—`, arrows `→`, emoji, curly quotes) inside a fenced code block cause VSCode canvas extensions to show "Error parsing" on that node. Unicode is fine in prose, headings, and bullet points — only the content *between* ` ``` ` fences must be ASCII. Use `--` for em dash, `->` for arrows, `...` for ellipsis. See `rules/code-block-ascii-only.md`.

**Node Sizing Tiers** (from [Obsidian's official sample](https://github.com/obsidianmd/jsoncanvas/blob/main/sample.canvas)):

| Tier | Width | Height | Use for |
|------|-------|--------|---------|
| Small | 250 | 120 | Labels, short text, file refs |
| Medium | 400 | 300 | Paragraphs, lists, code blocks |
| Large | 570 | 500 | Long-form content, embedded files |

Content-based sizing heuristic: `height = max(100, lines * 60 + 40)`, `width = 300-420`. Center layouts around origin (negative coordinates are expected). See `rules/size-nodes-for-content.md`.

**Edge Defaults**: Per the [spec](https://jsoncanvas.org/spec/1.0/), `fromEnd` defaults to `"none"` and `toEnd` defaults to `"arrow"`. Omitting both produces a standard directional arrow. `fromSide`/`toSide` are optional -- when omitted, Obsidian auto-routes. Set them explicitly only for structured layouts.

```json
{ "id": "e1a2b3c4d5e6f7g8", "fromNode": "nodeA", "toNode": "nodeB" }
{ "id": "e2b3c4d5e6f7g8h9", "fromNode": "nodeA", "toNode": "nodeB", "fromEnd": "arrow", "toEnd": "arrow", "label": "bidirectional" }
```


## Quick Reference

| Element | Required Fields | Optional Fields |
|---------|----------------|-----------------|
| Text node | `id`, `type`, `x`, `y`, `width`, `height`, `text` | `color` |
| Group node | `id`, `type`, `x`, `y`, `width`, `height` | `color`, `label`, `background`, `backgroundStyle` |
| File node | `id`, `type`, `x`, `y`, `width`, `height`, `file` | `color`, `subpath` |
| Link node | `id`, `type`, `x`, `y`, `width`, `height`, `url` | `color` |
| Edge | `id`, `fromNode`, `toNode` | `fromSide`, `toSide`, `fromEnd`, `toEnd`, `label`, `color` |
| Side values | `"top"`, `"bottom"`, `"left"`, `"right"` | |
| Color values | Presets: `"1"` red, `"2"` orange, `"3"` yellow, `"4"` green, `"5"` cyan, `"6"` purple | Hex: `"#RRGGBB"` |
| End values | `"none"`, `"arrow"` | Defaults: `fromEnd`=none, `toEnd`=arrow |
| Background styles | `"cover"`, `"ratio"`, `"repeat"` | For group `backgroundStyle` |


## Reference Files

Consult these when you need specific guidance:

- `rules/generate-unique-ids.md` -- when creating canvas JSON directly (without the script) and need collision-free IDs
- `rules/choose-layout-strategy.md` -- when deciding which layout algorithm to use for the canvas
- `rules/size-nodes-for-content.md` -- when sizing nodes manually or overriding script auto-sizing
- `rules/place-nodes-inside-groups.md` -- when computing group bounds from children or nesting groups
- `rules/connect-edges-by-side.md` -- when setting explicit edge attachment sides for structured layouts
- `rules/layout-for-readability.md` -- when fine-tuning spacing, alignment, or layout after script generation
- `rules/update-canvases-safely.md` -- when modifying an existing canvas without breaking edge references
- `rules/code-block-ascii-only.md` -- **always apply**: fenced code blocks must contain only ASCII characters; Unicode (em dashes, arrows, emoji, curly quotes) inside a ` ``` ` fence causes parse errors in VSCode canvas extensions
