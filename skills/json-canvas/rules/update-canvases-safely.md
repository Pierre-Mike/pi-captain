# Update Existing Canvases Without Breaking References

When modifying an existing canvas, preserve the IDs of nodes and edges you're not changing. Edges reference nodes by ID -- if you regenerate a node with a new ID, every edge pointing to the old ID breaks silently (the edge remains in JSON but renders disconnected in Obsidian). Read the existing canvas first, then modify in place rather than rewriting from scratch.

## Avoid

```json
// Original canvas has: { "id": "scan003", "type": "text", ... }
// Edge references it: { "fromNode": "scan003", "toNode": "scan004" }

// After "updating", you regenerate everything with new IDs:
{
  "nodes": [
    { "id": "abc123def456gh78", "type": "text", "text": "Updated content for scan003" },
    { "id": "xyz789uvw012st34", "type": "text", "text": "Updated content for scan004" }
  ],
  "edges": [
    { "id": "edge01", "fromNode": "abc123def456gh78", "toNode": "xyz789uvw012st34" }
  ]
}
// All IDs changed -- any external references or user bookmarks are broken
// If you missed updating an edge's fromNode/toNode, it silently disconnects
```

## Prefer

```json
// Read existing canvas first, then modify only what changed:
{
  "nodes": [
    { "id": "scan003", "type": "text", "text": "Updated content -- same ID preserved" },
    { "id": "scan004", "type": "text", "text": "Updated content -- same ID preserved" },
    { "id": "newnode01abcdef12", "type": "text", "text": "Brand new node with fresh ID" }
  ],
  "edges": [
    { "id": "sedge3", "fromNode": "scan003", "toNode": "scan004", "toEnd": "arrow" },
    { "id": "newedge01", "fromNode": "scan004", "toNode": "newnode01abcdef12", "toEnd": "arrow" }
  ]
}
// Existing node IDs (scan003, scan004) preserved
// Existing edge IDs (sedge3) preserved with same node references
// New elements get new unique IDs
// Only changed properties are modified (text content)
```
