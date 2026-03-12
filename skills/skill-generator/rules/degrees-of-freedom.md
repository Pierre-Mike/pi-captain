# Match rule specificity to the task's fragility

Not all rules need the same level of detail. High-fragility tasks (file format manipulation, API protocols) need strict scripts with few parameters. Low-fragility tasks (writing prose, choosing architecture) need loose guidance. Mismatching specificity wastes tokens on flexible tasks and causes errors on fragile ones.

## Avoid

```markdown
# Rule: Database Queries

Always write queries like this exact pattern:

```sql
SELECT id, name, email
FROM users
WHERE created_at > '2024-01-01'
ORDER BY created_at DESC
LIMIT 100;
```

Follow this template exactly for all queries.
```

Over-specifying a flexible task. Query structure depends on the schema, the question, and the context. A rigid template adds no value here.

## Prefer

Three levels of freedom, matched to fragility:

**High freedom** (text-based guidance) -- use when multiple approaches are valid:

```markdown
# Write clear commit messages

Summarize the change in imperative mood. Include context for why the
change was made, not just what changed. Keep the subject line under
72 characters.
```

**Medium freedom** (pseudocode or parameterized patterns) -- use when a preferred pattern exists but variation is acceptable:

```markdown
# Structure API error responses

Return errors with this shape, adapting fields to your domain:

```json
{
  "error": {
    "code": "<DOMAIN_ERROR_CODE>",
    "message": "<human-readable explanation>",
    "details": {}
  }
}
```
```

**Low freedom** (specific scripts, exact steps) -- use when operations are fragile and error-prone:

```markdown
# Rotate a PDF page

Run the rotation script. Do not implement rotation manually --
the coordinate math is error-prone and the script handles edge cases.

```bash
scripts/rotate_pdf.py input.pdf --page 3 --degrees 90 --output rotated.pdf
```
```

Think of Claude as exploring a path: a narrow bridge with cliffs needs specific guardrails (low freedom), while an open field allows many valid routes (high freedom). This framing comes from the Anthropic official skill-creator pattern.
