# Output Patterns

Complete templates for generating skill files. Use these as starting points, replacing [TODO:] markers with actual content.

## Self-Contained Skill (3 files)

For skills where all knowledge fits in SKILL.md under 500 lines.

```
my-skill/
├── SKILL.md
├── metadata.json
└── rules/
    ├── _template.md
    └── [rule-name].md
```

### SKILL.md Template

```markdown
---
name: [TODO: kebab-case-name]
description: >
  [TODO: 100+ word description. Include what the skill does, specific
  trigger scenarios, and "Use when" phrasing. Example: "Comprehensive
  API validation for REST endpoints with support for schema checking,
  response format verification, and error handling patterns. Use when
  working with API responses for: (1) Validating response shapes
  against schemas, (2) Checking error response formats, (3) Testing
  endpoint behavior, or any API quality task."]
---

# [TODO: Skill Title]

## Core Concepts

**[TODO: Concept 1 title]**: [TODO: Explanation of why this matters,
not just what to do. Include a code example if the concept is technical.]

**[TODO: Concept 2 title]**: [TODO: Second most important concept.
Keep to 2-3 core concepts that are always relevant.]

## Quick Patterns

[TODO: Numbered steps for the primary workflow]

1. **[Step name]** -- [What to do and why]
2. **[Step name]** -- [What to do and why]

## Reference Files

Consult these only when you need specific details:

- `rules/[rule-name].md` -- when you need to [specific scenario]
- `rules/[rule-name].md` -- when you need to [specific scenario]
```

### metadata.json Template

```json
{
  "triggers": [
    "[TODO: 100+ word description of first trigger scenario]",
    "[TODO: 100+ word description of second trigger scenario]"
  ]
}
```

### Rule File Template

```markdown
# [TODO: Imperative title stating what to do]

[TODO: 1-2 sentences explaining WHY this rule matters. Focus on
consequences of getting it wrong, not just instructions.]

## Avoid

\`\`\`[language]
// [TODO: Bad example with comment explaining what's wrong]
\`\`\`

## Prefer

\`\`\`[language]
// [TODO: Good example with comment explaining what's right]
\`\`\`
```

## Navigation Skill (references/ pattern)

For skills too large for a single SKILL.md. SKILL.md acts as a router,
references/ holds domain-specific content.

```
my-skill/
├── SKILL.md              # Router: core workflow + navigation
├── metadata.json
├── references/
│   ├── [domain-a].md     # Detailed content for domain A
│   ├── [domain-b].md     # Detailed content for domain B
│   └── [domain-c].md     # Detailed content for domain C
└── rules/
    ├── _template.md
    └── [rule-name].md
```

### Navigation SKILL.md Template

```markdown
---
name: [TODO: kebab-case-name]
description: >
  [TODO: 100+ word description covering all domains/variants]
---

# [TODO: Skill Title]

## Core Workflow

[TODO: Brief overview of the shared workflow that applies regardless
of which domain/variant the user needs]

## Choose Your Path

[TODO: Decision tree or routing logic]

```
What are you working with?
├── [Domain A]? --> Read references/[domain-a].md
├── [Domain B]? --> Read references/[domain-b].md
└── [Domain C]? --> Read references/[domain-c].md
```

## Reference Files

- `references/[domain-a].md` -- when working with [domain A scenarios]
- `references/[domain-b].md` -- when working with [domain B scenarios]
- `references/[domain-c].md` -- when working with [domain C scenarios]
- `rules/[rule-name].md` -- when you need [specific guidance]
```

## Full Skill (scripts/ + references/ + rules/)

For skills that include executable scripts and reference documentation.

```
my-skill/
├── SKILL.md
├── metadata.json
├── scripts/
│   ├── [action].ts       # Executable script for specific task
│   └── [validate].ts     # Validation or checking script
├── references/
│   └── [topic].md        # Detailed reference documentation
└── rules/
    ├── _template.md
    └── [rule-name].md
```

### Script Reference in SKILL.md

```markdown
## Available Scripts

- `scripts/[action].ts` -- [What it does]. Run with: `bun scripts/[action].ts [args]`
- `scripts/[validate].ts` -- [What it checks]. Run with: `bun scripts/[validate].ts [args]`
```

## Enhanced Rule Template with Decision Tree

For rules that cover multiple approaches:

```markdown
# [TODO: Imperative title]

[TODO: Why this rule matters]

## Decision Tree

```
[Situation]?
├── [Condition A]? --> [Approach A]
├── [Condition B]? --> [Approach B]
└── [Default] --> [Fallback approach]
```

## Degrees of Freedom

**High** (loose guidance): [When to use high freedom for this rule]
**Medium** (parameterized): [When to use medium freedom]
**Low** (strict script): [When to use low freedom]

## Avoid

\`\`\`[language]
// [Bad example]
\`\`\`

## Prefer

\`\`\`[language]
// [Good example for the most common case]
\`\`\`
```
