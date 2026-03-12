# Choose the Right Layout Strategy Before Computing Positions

Before writing any coordinates, decide which layout algorithm fits the content. The script (`scripts/generate-canvas.py`) handles the computation -- you just pick the strategy and set `"layout"` in the intermediate JSON. Choosing wrong produces layouts that fight the content structure.

```
What structure does the content have?

├── Clear hierarchy or flow (parent→child, step→step)?
│   ├── Few levels (2-3), broad?
│   │   └── "tree" with direction "TB" or "LR"
│   └── Many levels (4+), deep?
│       └── "layered" with direction "TB"
│
├── Central concept with branches?
│   └── "radial" (first node = center)
│
├── Temporal ordering or sequence?
│   └── "tree" with direction "LR" (timeline)
│
├── Comparing N independent items?
│   └── "grid"
│
├── Grouped modules with internal structure?
│   └── "grid" with group nodes (script computes group bounds)
│
└── No clear structure?
    └── "grid" as safe default
```

## Avoid

```json
{
  "layout": "grid",
  "nodes": [
    { "content": "## Start" },
    { "content": "## Process A" },
    { "content": "## Process B" },
    { "content": "## End" }
  ],
  "edges": [
    { "from": 0, "to": 1 },
    { "from": 0, "to": 2 },
    { "from": 1, "to": 3 },
    { "from": 2, "to": 3 }
  ]
}
// Grid layout for a flow diagram -- edges will cross awkwardly
// because grid doesn't consider edge relationships when positioning
```

## Prefer

```json
{
  "layout": "tree",
  "direction": "TB",
  "nodes": [
    { "content": "## Start", "color": "1" },
    { "content": "## Process A", "color": "4" },
    { "content": "## Process B", "color": "5" },
    { "content": "## End", "color": "3" }
  ],
  "edges": [
    { "from": 0, "to": 1 },
    { "from": 0, "to": 2 },
    { "from": 1, "to": 3 },
    { "from": 2, "to": 3 }
  ]
}
// Tree layout for a flow diagram -- nodes arranged by depth
// with edges flowing cleanly top-to-bottom
```
