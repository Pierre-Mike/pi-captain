# Generate Unique IDs for Every Element

Every node and edge in a canvas needs a unique `id` string. Obsidian uses these IDs for edge references, node lookups, and persistence. Duplicate IDs cause edges to attach to the wrong node or silently break when the canvas is reloaded.

**Use the script** (`scripts/generate-canvas.py`) for reliable ID generation -- it calls `os.urandom(8).hex()` which produces cryptographically random 16-char hex strings with near-zero collision probability.

**When writing JSON directly**: Use 16-character hex strings for all IDs (nodes and edges alike). Generate them randomly -- don't use sequential counters, semantic names, or short prefixes. IDs are internal identifiers, not labels.

## Avoid

```json
{
  "nodes": [
    { "id": "1", "type": "text", "x": 0, "y": 0, "width": 300, "height": 100, "text": "Node A" },
    { "id": "header", "type": "text", "x": 0, "y": 200, "width": 300, "height": 100, "text": "Node B" },
    { "id": "n3", "type": "text", "x": 0, "y": 400, "width": 300, "height": 100, "text": "Node C" }
  ],
  "edges": [
    { "id": "1", "fromNode": "1", "toNode": "header" }
  ]
}
// Mixed ID formats: "1" (counter), "header" (semantic), "n3" (short prefix)
// Edge id "1" collides with node id "1"
// Short IDs risk collisions when canvases are merged or extended
```

## Prefer

```json
{
  "nodes": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 0, "y": 0, "width": 300, "height": 100, "text": "Node A" },
    { "id": "b2c3d4e5f6g7h8i9", "type": "text", "x": 0, "y": 200, "width": 300, "height": 100, "text": "Node B" },
    { "id": "c3d4e5f6g7h8i9j0", "type": "text", "x": 0, "y": 400, "width": 300, "height": 100, "text": "Node C" }
  ],
  "edges": [
    { "id": "e1f2a3b4c5d6e7f8", "fromNode": "a1b2c3d4e5f6g7h8", "toNode": "b2c3d4e5f6g7h8i9" }
  ]
}
// Consistent 16-char hex IDs for all elements
// Every ID is unique across nodes and edges
// No semantic meaning in IDs -- content is in the node properties
```
