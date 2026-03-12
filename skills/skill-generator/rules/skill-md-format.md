# Write SKILL.md with lean frontmatter and inline core knowledge

SKILL.md is loaded every time the skill triggers, so it should teach the essential concepts directly — not just point to other files. Keep frontmatter to name + description only. Inline the 2-3 highest-priority concepts with code examples. List reference files at the bottom with "when to consult" guidance.

## Avoid

```markdown
---
name: my-skill
description: Does stuff
version: 1.0.0
priority: CRITICAL
author: someone
tags: [foo, bar]
---

# My Skill

CRITICAL: You MUST follow these rules ALWAYS.

See the following files for details:
- rules/rule-1.md
- rules/rule-2.md
- rules/rule-3.md
```

## Prefer

```markdown
---
name: my-skill
description: Validates API responses for type safety and error handling.
---

# My Skill

## Core Concepts

**Validate response shapes before use**: API responses can drift from
expected types. Check required fields exist before accessing them.

\`\`\`typescript
// Good: Validate before use
const data = await fetchUser(id);
if (!data || !data.email) throw new ValidationError("Missing email");
return data.email;
\`\`\`

**Return structured errors, not strings**: Callers need error codes and
context to handle failures. Strings lose information.

## Reference Files

Consult these only when you need specific details:

- `rules/response-validation.md` — when validating complex nested responses
- `rules/error-structure.md` — when designing error return types
```
