# Connect Edges Using Correct Side References

Edges connect nodes by specifying `fromNode` and `toNode` (IDs). The `fromSide`, `toSide`, `fromEnd`, and `toEnd` properties are all **optional** per the spec.

**Defaults when omitted**:
- `fromSide`/`toSide`: Obsidian auto-routes the connection (often the best choice for simple canvases)
- `fromEnd`: `"none"` (no arrowhead at start)
- `toEnd`: `"arrow"` (arrowhead at end)

Omitting both ends produces a standard directional arrow. Set `fromEnd: "arrow"` for bidirectional arrows.

**When to set sides explicitly**: Only for structured layouts where you control the flow direction. Match sides to layout direction:
- Top-down flow: `fromSide: "bottom"`, `toSide: "top"`
- Left-to-right flow: `fromSide: "right"`, `toSide: "left"`
- Bidirectional/organic: omit sides, let Obsidian auto-route

The script (`scripts/generate-canvas.py`) selects sides automatically based on relative node positions.

## Avoid

```json
{
  "edges": [
    {
      "id": "e1a2b3c4d5e6f7g8",
      "fromNode": "a1b2c3d4e5f6g7h8",
      "fromSide": "left",
      "toNode": "b2c3d4e5f6g7h8i9",
      "toSide": "right",
      "toEnd": "arrow"
    }
  ]
}
// Source is above target, but sides are set to left/right
// Creates an awkward diagonal line crossing other elements
// toEnd is redundant (it's the default)
```

## Prefer

```json
{
  "edges": [
    {
      "id": "e1a2b3c4d5e6f7g8",
      "fromNode": "a1b2c3d4e5f6g7h8",
      "toNode": "b2c3d4e5f6g7h8i9",
      "label": "triggers"
    }
  ]
}
// Minimal edge: just fromNode and toNode
// Obsidian auto-routes and adds arrow (toEnd defaults to "arrow")
// Label explains the relationship
// Sides omitted for clean auto-routing
```

```json
{
  "edges": [
    {
      "id": "e2b3c4d5e6f7g8h9",
      "fromNode": "a1b2c3d4e5f6g7h8",
      "fromSide": "bottom",
      "toNode": "b2c3d4e5f6g7h8i9",
      "toSide": "top",
      "fromEnd": "arrow",
      "toEnd": "arrow",
      "label": "syncs with"
    }
  ]
}
// Explicit sides matching top-down layout
// fromEnd + toEnd both "arrow" = bidirectional
// Label on bidirectional edge clarifies relationship
```
