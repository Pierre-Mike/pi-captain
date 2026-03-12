# Write comprehensive trigger descriptions in frontmatter

The `description` field in SKILL.md frontmatter is the primary mechanism Claude uses to decide whether to activate a skill. Short, vague descriptions cause missed triggers or false activations. Write 100+ word descriptions that include what the skill does, specific scenarios that should trigger it, and "Use when" phrasing to enumerate trigger conditions.

## Avoid

```yaml
---
name: my-skill
description: Does stuff with documents.
---
```

```yaml
---
name: api-validator
description: Validates APIs.
---
```

Vague descriptions give Claude no signal about when to activate. "Does stuff" matches everything and nothing.

## Prefer

```yaml
---
name: document-processor
description: >
  Comprehensive document creation, editing, and analysis with support
  for tracked changes, comments, formatting preservation, and text
  extraction. Use when working with professional documents (.docx files)
  for: (1) Creating new documents with structured content and formatting,
  (2) Modifying or editing existing document content while preserving
  styles, (3) Working with tracked changes and revision history,
  (4) Adding comments and annotations, (5) Extracting text or metadata
  from documents, or any other document processing task. Triggers on
  requests involving Word documents, report generation, or document
  templates.
---
```

This pattern comes from the Anthropic official skill-creator. Notice:
- Action verbs describe capabilities ("creation, editing, analysis")
- Numbered scenarios enumerate specific trigger conditions
- "Use when" phrasing gives Claude clear activation criteria
- Domain terms ("tracked changes", ".docx") help match user intent
- Description stays under 1024 characters (the maximum allowed)
