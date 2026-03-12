# Size Nodes Based on Content Length

When writing canvas JSON directly (without the script), choose node dimensions based on content. The script auto-sizes nodes, but when overriding or working manually, use these tiers and heuristics. Incorrectly sized nodes are the most visible rendering issue -- text gets clipped or nodes have excessive whitespace.

**Sizing tiers** (from Obsidian's official sample):

| Tier | Width | Height | Use for |
|------|-------|--------|---------|
| Small | 250 | 120 | Labels, short titles, file/link refs |
| Medium | 400 | 300 | Paragraphs, short lists, 3-8 lines |
| Large | 420-570 | 400-500 | Long content, tables, code blocks |

**Content-based formula**: `height = max(100, lines * 60 + 40)`, `width = 300-420`.

Count lines as: number of `\n` characters + 1. Headings (`##`) count as ~1.5 lines. Code blocks and tables need extra height (~80px per block).

## Avoid

```json
{ "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 0, "y": 0, "width": 200, "height": 60,
  "text": "## Architecture Overview\n\nThis module handles authentication, session management, and token refresh.\n\n- OAuth2 flow\n- JWT validation\n- Session storage\n- Rate limiting" }
// 200x60 is far too small for 8 lines of content
// Text will be clipped in Obsidian with no scroll
```

## Prefer

```json
{ "id": "a1b2c3d4e5f6g7h8", "type": "text", "x": 0, "y": 0, "width": 400, "height": 400,
  "text": "## Architecture Overview\n\nThis module handles authentication, session management, and token refresh.\n\n- OAuth2 flow\n- JWT validation\n- Session storage\n- Rate limiting" }
// 400x400 fits 8 lines comfortably (8 * 60 + 40 = 520, rounded down since list items are compact)
// Width of 400 is in the readable medium tier
```
