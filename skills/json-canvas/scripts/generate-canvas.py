#!/usr/bin/env python3
"""Generate valid Obsidian .canvas JSON from an intermediate node/edge description.

Usage:
    echo '{"layout":"grid","nodes":[...]}' | python3 generate-canvas.py
    python3 generate-canvas.py input.json
    python3 generate-canvas.py input.json -o output.canvas
    python3 generate-canvas.py --help

Intermediate format:
{
  "layout": "grid|tree|layered|radial|manual",
  "direction": "TB|BT|LR|RL",          # default: TB
  "spacing": 80,                         # override default gaps
  "nodes": [
    {
      "content": "## Title\\nBody text",  # required for text nodes
      "type": "text|group|file|link",     # default: text
      "color": "1",                       # preset "1"-"6" or hex "#RRGGBB"
      "group": 0,                         # index of parent group node
      "label": "GROUP NAME",             # for group nodes
      "file": "path/to/file.md",         # for file nodes
      "url": "https://...",              # for link nodes
      "width": 400,                       # override auto-sizing
      "height": 200                       # override auto-sizing
    }
  ],
  "edges": [
    {
      "from": 0,                          # node index
      "to": 1,                            # node index
      "label": "relationship",            # optional
      "bidirectional": false              # adds arrows on both ends
    }
  ]
}
"""

import json
import math
import os
import sys
import argparse


def generate_hex_id():
    """Generate a 16-character random hex string."""
    return os.urandom(8).hex()


def estimate_node_size(node):
    """Estimate width and height from content length."""
    if node.get("type") == "group":
        return node.get("width", 440), node.get("height", 340)
    if node.get("type") in ("file", "link"):
        return node.get("width", 300), node.get("height", 100)

    content = node.get("content", "")
    lines = content.count("\n") + 1

    if lines <= 2:
        w, h = 250, 120  # small
    elif lines <= 8:
        w, h = 400, max(200, lines * 60 + 40)  # medium
    else:
        w, h = 420, max(300, lines * 50 + 40)  # large

    return node.get("width", w), node.get("height", h)


def layout_grid(nodes, sizes, spacing=80):
    """Arrange nodes in a grid centered around origin."""
    n = len(nodes)
    if n == 0:
        return []

    cols = math.ceil(math.sqrt(n))
    positions = []

    max_w = max(s[0] for s in sizes)
    max_h = max(s[1] for s in sizes)
    cell_w = max_w + spacing
    cell_h = max_h + spacing

    rows = math.ceil(n / cols)
    total_w = cols * cell_w - spacing
    total_h = rows * cell_h - spacing
    offset_x = -total_w / 2
    offset_y = -total_h / 2

    for i in range(n):
        col = i % cols
        row = i // cols
        x = offset_x + col * cell_w + (cell_w - sizes[i][0]) / 2
        y = offset_y + row * cell_h + (cell_h - sizes[i][1]) / 2
        positions.append((round(x), round(y)))

    return positions


def layout_tree(nodes, edges, sizes, direction="TB", spacing=None):
    """Arrange nodes in a tree layout. Root = node with no incoming edges."""
    n = len(nodes)
    if n == 0:
        return []

    sibling_gap = spacing or 60
    level_gap = spacing or 120

    incoming = set()
    children_map = {}
    for e in edges:
        incoming.add(e["to"])
        children_map.setdefault(e["from"], []).append(e["to"])

    roots = [i for i in range(n) if i not in incoming]
    if not roots:
        roots = [0]

    # Assign layers via BFS
    layers = {}
    visited = set()
    queue = [(r, 0) for r in roots]
    for r in roots:
        visited.add(r)
    while queue:
        node_idx, depth = queue.pop(0)
        layers[node_idx] = depth
        for child in children_map.get(node_idx, []):
            if child not in visited:
                visited.add(child)
                queue.append((child, depth + 1))

    # Add orphans
    for i in range(n):
        if i not in layers:
            layers[i] = 0

    # Group by layer
    by_layer = {}
    for idx, layer in layers.items():
        by_layer.setdefault(layer, []).append(idx)

    # Compute positions
    positions = [None] * n
    is_horizontal = direction in ("LR", "RL")

    max_layer = max(by_layer.keys()) if by_layer else 0

    for layer_idx in sorted(by_layer.keys()):
        layer_nodes = by_layer[layer_idx]
        if is_horizontal:
            total = sum(sizes[i][1] for i in layer_nodes) + sibling_gap * (len(layer_nodes) - 1)
            cursor = -total / 2
            for i in layer_nodes:
                lx = layer_idx * (max(sizes[j][0] for j in range(n)) + level_gap)
                if direction == "RL":
                    lx = -lx
                positions[i] = (round(lx), round(cursor))
                cursor += sizes[i][1] + sibling_gap
        else:
            total = sum(sizes[i][0] for i in layer_nodes) + sibling_gap * (len(layer_nodes) - 1)
            cursor = -total / 2
            for i in layer_nodes:
                ly = layer_idx * (max(sizes[j][1] for j in range(n)) + level_gap)
                if direction == "BT":
                    ly = -ly
                positions[i] = (round(cursor), round(ly))
                cursor += sizes[i][0] + sibling_gap

    return positions


def layout_layered(nodes, edges, sizes, direction="TB", spacing=None):
    """Layered layout using Sugiyama-style layer assignment. Falls back to tree."""
    return layout_tree(nodes, edges, sizes, direction, spacing)


def layout_radial(nodes, edges, sizes, spacing=None):
    """Arrange nodes radially. First node at center, rest in concentric rings."""
    n = len(nodes)
    if n == 0:
        return []
    if n == 1:
        return [(0, 0)]

    positions = [(0, 0)]  # center node
    radius = spacing or 300
    remaining = list(range(1, n))

    ring = 1
    while remaining:
        circumference = 2 * math.pi * radius * ring
        max_per_ring = max(1, int(circumference / (max(sizes[i][0] for i in remaining) + 40)))
        ring_nodes = remaining[:max_per_ring]
        remaining = remaining[max_per_ring:]

        for j, idx in enumerate(ring_nodes):
            angle = (2 * math.pi * j) / len(ring_nodes) - math.pi / 2
            x = math.cos(angle) * radius * ring
            y = math.sin(angle) * radius * ring
            positions.append((round(x), round(y)))

        ring += 1

    return positions


def compute_group_bounds(group_idx, nodes, positions, sizes, padding=20, label_offset=30):
    """Compute group bounds from its children's positions and sizes."""
    children = [i for i, n in enumerate(nodes) if n.get("group") == group_idx]
    if not children:
        return positions[group_idx][0], positions[group_idx][1], sizes[group_idx][0], sizes[group_idx][1]

    min_x = min(positions[i][0] for i in children)
    min_y = min(positions[i][1] for i in children)
    max_x = max(positions[i][0] + sizes[i][0] for i in children)
    max_y = max(positions[i][1] + sizes[i][1] for i in children)

    gx = min_x - padding
    gy = min_y - label_offset
    gw = (max_x - min_x) + 2 * padding
    gh = (max_y - min_y) + padding + label_offset

    return gx, gy, gw, gh


def select_edge_sides(from_pos, from_size, to_pos, to_size):
    """Select edge attachment sides based on relative positions."""
    from_cx = from_pos[0] + from_size[0] / 2
    from_cy = from_pos[1] + from_size[1] / 2
    to_cx = to_pos[0] + to_size[0] / 2
    to_cy = to_pos[1] + to_size[1] / 2

    dx = to_cx - from_cx
    dy = to_cy - from_cy

    if abs(dx) > abs(dy):
        from_side = "right" if dx > 0 else "left"
        to_side = "left" if dx > 0 else "right"
    else:
        from_side = "bottom" if dy > 0 else "top"
        to_side = "top" if dy > 0 else "bottom"

    return from_side, to_side


UNICODE_REPLACEMENTS = [
    ("\u2014", "--"),   # em dash  —
    ("\u2013", "-"),    # en dash  –
    ("\u2026", "..."),  # ellipsis …
    ("\u2192", "->"),   # right arrow →
    ("\u2190", "<-"),   # left arrow ←
    ("\u2191", "^"),    # up arrow ↑
    ("\u2193", "v"),    # down arrow ↓
    ("\u201c", '"'),    # left double quote "
    ("\u201d", '"'),    # right double quote "
    ("\u2018", "'"),    # left single quote '
    ("\u2019", "'"),    # right single quote '
]


def ascii_code_blocks(text):
    """Replace non-ASCII characters inside fenced code blocks with ASCII equivalents.

    VSCode canvas extensions fail to parse text nodes that contain Unicode
    characters (e.g. em dash U+2014) inside a fenced code block.  Prose and
    headings outside the fence are left untouched.
    """
    import re

    def sanitize_block(m):
        fence_open = m.group(1)   # e.g. ```ts
        body       = m.group(2)   # everything between the fences
        fence_close = m.group(3)  # ```

        for uni, asc in UNICODE_REPLACEMENTS:
            body = body.replace(uni, asc)

        # Strip any remaining non-ASCII characters (e.g. emoji in comments)
        body = body.encode("ascii", errors="replace").decode("ascii").replace("?", "?")

        return fence_open + body + fence_close

    return re.sub(r"(```[^\n]*\n)(.*?)(```)", sanitize_block, text, flags=re.DOTALL)


def validate_code_blocks(text, node_id=""):
    """Warn if a text node's code blocks still contain non-ASCII after sanitization."""
    import re
    warnings = []
    for i, block in enumerate(re.findall(r"```[^\n]*\n(.*?)```", text, re.DOTALL)):
        bad = [(j, c, f"U+{ord(c):04X}") for j, c in enumerate(block) if ord(c) > 127]
        if bad:
            for pos, char, code in bad:
                ctx = block[max(0, pos - 15):pos + 15].replace("\n", "↵")
                warnings.append(f"  node {node_id!r} code block #{i}: {code} {char!r} at ...{ctx}...")
    return warnings


def generate_canvas(spec):
    """Generate .canvas JSON from intermediate format."""
    nodes_spec = spec.get("nodes", [])
    edges_spec = spec.get("edges", [])
    layout = spec.get("layout", "grid")
    direction = spec.get("direction", "TB")
    spacing = spec.get("spacing")

    # 1. Estimate sizes
    sizes = [estimate_node_size(n) for n in nodes_spec]

    # 2. Separate group children for layout
    # Non-group nodes and groups get laid out; children get positioned inside groups later
    grouped = {i for i, n in enumerate(nodes_spec) if n.get("group") is not None}
    layout_indices = [i for i in range(len(nodes_spec)) if i not in grouped]

    # 3. Compute layout for non-grouped nodes
    layout_nodes = [nodes_spec[i] for i in layout_indices]
    layout_sizes = [sizes[i] for i in layout_indices]
    layout_edges = []
    index_map = {orig: new for new, orig in enumerate(layout_indices)}

    for e in edges_spec:
        if e["from"] in index_map and e["to"] in index_map:
            layout_edges.append({"from": index_map[e["from"]], "to": index_map[e["to"]]})

    if layout == "tree":
        layout_positions = layout_tree(layout_nodes, layout_edges, layout_sizes, direction, spacing)
    elif layout == "layered":
        layout_positions = layout_layered(layout_nodes, layout_edges, layout_sizes, direction, spacing)
    elif layout == "radial":
        layout_positions = layout_radial(layout_nodes, layout_edges, layout_sizes, spacing)
    elif layout == "manual":
        layout_positions = [(n.get("x", 0), n.get("y", 0)) for n in layout_nodes]
    else:  # grid
        layout_positions = layout_grid(layout_nodes, layout_sizes, spacing or 80)

    # 4. Map positions back to original indices
    positions = [None] * len(nodes_spec)
    for new_idx, orig_idx in enumerate(layout_indices):
        positions[orig_idx] = layout_positions[new_idx]

    # 5. Position grouped children inside their parent groups
    for i, n in enumerate(nodes_spec):
        group_idx = n.get("group")
        if group_idx is not None and positions[group_idx] is not None:
            # Stack children vertically inside group
            siblings = [j for j, m in enumerate(nodes_spec) if m.get("group") == group_idx and j <= i]
            offset_y = 30  # label clearance
            for sib in siblings[:-1]:
                offset_y += sizes[sib][1] + 10
            gx, gy = positions[group_idx]
            positions[i] = (gx + 20, gy + offset_y)
            # Clamp child width to group
            sizes[i] = (min(sizes[i][0], sizes[group_idx][0] - 40), sizes[i][1])

    # 6. Recompute group bounds from children
    for i, n in enumerate(nodes_spec):
        if n.get("type") == "group":
            gx, gy, gw, gh = compute_group_bounds(i, nodes_spec, positions, sizes)
            positions[i] = (gx, gy)
            sizes[i] = (gw, gh)

    # 7. Handle any remaining None positions
    for i in range(len(positions)):
        if positions[i] is None:
            positions[i] = (0, 0)

    # 8. Generate IDs
    node_ids = [generate_hex_id() for _ in nodes_spec]

    # 9. Build output nodes (z-index: groups first, then others)
    output_nodes = []
    order = sorted(range(len(nodes_spec)), key=lambda i: 0 if nodes_spec[i].get("type") == "group" else 1)

    for i in order:
        n = nodes_spec[i]
        node_type = n.get("type", "text")
        canvas_node = {
            "id": node_ids[i],
            "type": node_type,
            "x": positions[i][0],
            "y": positions[i][1],
            "width": sizes[i][0],
            "height": sizes[i][1],
        }

        if n.get("color"):
            canvas_node["color"] = n["color"]

        if node_type == "text":
            canvas_node["text"] = ascii_code_blocks(n.get("content", ""))
        elif node_type == "group":
            if n.get("label"):
                canvas_node["label"] = n["label"]
            if n.get("background"):
                canvas_node["background"] = n["background"]
            if n.get("backgroundStyle"):
                canvas_node["backgroundStyle"] = n["backgroundStyle"]
        elif node_type == "file":
            canvas_node["file"] = n.get("file", "")
            if n.get("subpath"):
                canvas_node["subpath"] = n["subpath"]
        elif node_type == "link":
            canvas_node["url"] = n.get("url", "")

        output_nodes.append(canvas_node)

    # 10. Build output edges
    output_edges = []
    for e in edges_spec:
        from_idx = e["from"]
        to_idx = e["to"]
        from_side, to_side = select_edge_sides(
            positions[from_idx], sizes[from_idx],
            positions[to_idx], sizes[to_idx]
        )

        canvas_edge = {
            "id": generate_hex_id(),
            "fromNode": node_ids[from_idx],
            "fromSide": from_side,
            "toNode": node_ids[to_idx],
            "toSide": to_side,
        }

        if e.get("bidirectional"):
            canvas_edge["fromEnd"] = "arrow"
        canvas_edge["toEnd"] = "arrow"

        if e.get("label"):
            canvas_edge["label"] = e["label"]
        if e.get("color"):
            canvas_edge["color"] = e["color"]

        output_edges.append(canvas_edge)

    # 11. Validate: warn if any code block still has non-ASCII
    all_warnings = []
    for node in output_nodes:
        if node.get("type") == "text":
            all_warnings.extend(validate_code_blocks(node["text"], node["id"]))
    if all_warnings:
        print("⚠ WARNING: non-ASCII characters remain in code blocks (may cause parse errors in VSCode):", file=sys.stderr)
        for w in all_warnings:
            print(w, file=sys.stderr)

    return {"nodes": output_nodes, "edges": output_edges}


def main():
    parser = argparse.ArgumentParser(
        description="Generate Obsidian .canvas JSON from intermediate format",
        epilog="Reads from stdin if no input file provided."
    )
    parser.add_argument("input", nargs="?", help="Input JSON file (or - for stdin)")
    parser.add_argument("-o", "--output", help="Output .canvas file (default: stdout)")
    parser.add_argument("--layout", help="Override layout: grid|tree|layered|radial|manual")
    parser.add_argument("--direction", help="Override direction: TB|BT|LR|RL")
    parser.add_argument("--spacing", type=int, help="Override spacing in pixels")
    args = parser.parse_args()

    if args.input and args.input != "-":
        with open(args.input) as f:
            spec = json.load(f)
    else:
        spec = json.load(sys.stdin)

    if args.layout:
        spec["layout"] = args.layout
    if args.direction:
        spec["direction"] = args.direction
    if args.spacing:
        spec["spacing"] = args.spacing

    result = generate_canvas(spec)
    output = json.dumps(result, indent=2)

    if args.output:
        with open(args.output, "w") as f:
            f.write(output)
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
