# Write rule files with no frontmatter and avoid/prefer examples

Rule files are reference material consulted on demand — they are not loaded unless Claude reads them. Each rule covers one concept. The title states what to do (imperative). The description explains why. Avoid/Prefer sections show concrete bad vs good examples. No frontmatter, no metadata, no tags.

## Avoid

```markdown
---
priority: HIGH
tags: [validation, api]
category: best-practice
---

# Rule: Validation

Validation is important. Here are some things to consider:

1. Always validate inputs
2. Check for null values
3. Use type guards

### Examples

Some examples of validation...
```

## Prefer

```markdown
# Validate inputs at system boundaries

Internal functions can trust their callers, but functions that accept
user input, API data, or file contents need validation. This prevents
corrupted data from propagating through the system.

## Avoid

\`\`\`typescript
// Bad: Trusts external input
function handleWebhook(body: any) {
  db.insert(body.event, body.data);
}
\`\`\`

## Prefer

\`\`\`typescript
// Good: Validates at the boundary
function handleWebhook(body: unknown) {
  const event = parseWebhookEvent(body);
  if (!event.ok) return { error: event.error };
  db.insert(event.data.type, event.data.payload);
}
\`\`\`
```
