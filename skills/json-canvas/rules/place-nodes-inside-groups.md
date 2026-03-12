# Place Child Nodes Inside Group Bounds

Group nodes act as visual containers in Obsidian. Containment is purely coordinate-based -- there is no parent/child JSON property. A node appears inside a group when its `x`, `y`, `width`, and `height` fall within the group's bounding box.

**Use children-first sizing**: Position child nodes first, then compute group bounds around them. This prevents the most common group layout bug (children overflowing the group).

Group bounds formula:
```
group.x = min(children.x) - padding        # padding = 20px
group.y = min(children.y) - labelOffset     # labelOffset = 30px (clears label text)
group.width = max(children.x + children.width) - min(children.x) + 2 * padding
group.height = max(children.y + children.height) - min(children.y) + padding + labelOffset
```

The script (`scripts/generate-canvas.py`) handles this automatically when you set `"group": <index>` on child nodes. Use this rule only when writing canvas JSON directly.

**Z-index**: Place group nodes before their children in the `nodes` array. Obsidian renders nodes in array order (first = bottom, last = top). Groups must render below their children.

## Avoid

```json
{
  "nodes": [
    { "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 20, "y": 30, "width": 360, "height": 250, "text": "Child content" },
    { "id": "b2c3d4e5f6g7h8i9", "type": "group", "x": 0, "y": 0, "width": 400, "height": 300, "label": "MY GROUP" }
  ]
}
// Group is after child in array -- renders on top, obscuring child
// Group size was guessed first, child squeezed to fit
```

## Prefer

```json
{
  "nodes": [
    { "id": "b2c3d4e5f6g7h8i9", "type": "group", "x": -20, "y": -30, "width": 400, "height": 310, "color": "4", "label": "MY GROUP" },
    { "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 0, "y": 0, "width": 360, "height": 250, "text": "Child content" }
  ]
}
// Group first in array (renders below child)
// Group bounds computed from child: x=0-20=-20, y=0-30=-30, w=360+40=400, h=250+30+30=310
// 20px padding on sides, 30px label offset on top
```
