# Choose the right progressive disclosure pattern for content organization

Skills share the context window with everything else Claude needs. Keep SKILL.md under 500 lines and split content into separate files when approaching this limit. Choose from three established patterns based on skill complexity, then reference split-out files clearly from SKILL.md so Claude knows they exist and when to read them.

## Avoid

```
my-skill/
├── SKILL.md    # 800 lines, covers everything in one file
└── rules/
    └── _template.md
```

Monolithic SKILL.md files bloat the context window. Claude loads SKILL.md every time the skill triggers, so excess content wastes tokens on every activation.

## Prefer

**Pattern 1: High-level guide with references** -- best when the skill has a simple core workflow plus advanced features:

```markdown
# PDF Processing

## Quick start
Extract text with pdfplumber:
[core code example]

## Advanced features
- **Form filling**: See references/forms.md for complete guide
- **API reference**: See references/api.md for all methods
```

Claude loads references/forms.md or references/api.md only when the user needs those features.

**Pattern 2: Domain-specific organization** -- best when the skill supports multiple independent domains or frameworks:

```
cloud-deploy/
├── SKILL.md (workflow + provider selection guidance)
└── references/
    ├── aws.md
    ├── gcp.md
    └── azure.md
```

When the user chooses AWS, Claude only reads references/aws.md. This prevents loading irrelevant GCP and Azure context.

**Pattern 3: Conditional details** -- best when the skill has basic and advanced modes:

```markdown
# Document Processing

## Creating documents
Use docx-js for new documents. See references/docx-js.md.

## Editing documents
For simple edits, modify the XML directly.

**For tracked changes**: See references/redlining.md
**For OOXML details**: See references/ooxml.md
```

Claude reads the advanced files only when the user's request requires them.

These patterns come from the Anthropic official skill-creator and the dtsola remotion-best-practices skill (Pattern 2 with 25+ rule files navigated from a single SKILL.md).
