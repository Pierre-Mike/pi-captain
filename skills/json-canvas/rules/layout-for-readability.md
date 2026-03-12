# Layout Nodes for Readable Flow

Arrange nodes in a clear visual hierarchy with consistent spacing. Obsidian renders coordinates exactly -- there's no auto-layout, so you control every pixel. Use the script for layouts with 5+ nodes. This rule applies when fine-tuning script output or writing small canvases manually.

**Two spacing dimensions**: Use different gaps for within-layer (siblings) vs between-layer (depth levels). Siblings need less space than layers because the eye follows flow direction more easily.

| Diagram type | Sibling gap | Layer gap | Node width |
|-------------|-------------|-----------|------------|
| Flowchart | 50-80px | 80-120px | 300-400px |
| Architecture | 80-100px | 100-150px | 400-420px |
| Mind map | 60-100px | 150-200px | 250-400px |
| Grid/comparison | 80px uniform | 80px uniform | 400px |

**Grid formula** (for unconnected collections): `columns = ceil(sqrt(N))`, `x = (i % cols) * (width + gap)`, `y = floor(i / cols) * (height + gap)`.

**Center around origin**: Use negative coordinates to center the layout. The title or root node should be near (0, 0).

## Avoid

```json
{
  "nodes": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 0, "y": 0, "width": 400, "height": 200, "text": "## Title" },
    { "id": "b2c3d4e5f6g7h8i9", "type": "text", "x": 3, "y": 205, "width": 180, "height": 300, "text": "## Module A" },
    { "id": "c3d4e5f6g7h8i9j0", "type": "text", "x": 187, "y": 201, "width": 250, "height": 340, "text": "## Module B" }
  ]
}
// Irregular spacing (3px, 205px) -- nodes nearly touching
// Module B overlaps Module A (187 < 3+180)
// Inconsistent widths, no centering around origin
// Same gap used everywhere (no sibling vs layer distinction)
```

## Prefer

```json
{
  "nodes": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": -200, "y": -180, "width": 400, "height": 140, "color": "1", "text": "## Title\n\nBrief description" },
    { "id": "b2c3d4e5f6g7h8i9", "type": "text", "x": -430, "y": 40, "width": 400, "height": 300, "color": "4", "text": "## Module A\n\nDetails..." },
    { "id": "c3d4e5f6g7h8i9j0", "type": "text", "x": 30, "y": 40, "width": 400, "height": 300, "color": "5", "text": "## Module B\n\nDetails..." }
  ]
}
// Title centered at top near origin
// 100px layer gap between title and modules (y: -180+140=−40 to 40)
// 60px sibling gap between modules (x: -430+400=−30 to 30)
// Consistent 400px width for same-level nodes
// Colors distinguish hierarchy levels
```
