---
name: skill-generator
description: >
  Generates new Claude Code skills following progressive disclosure
  principles, degrees-of-freedom matching, and patterns learned from
  real-world usage. Use when creating a new skill from requirements or
  domain knowledge, scaffolding a skill directory, converting a script
  or workflow into a reusable skill, building a skill based on codebase
  patterns, or restructuring an existing skill for better organization.
  Activates on requests to: (1) Generate or create a Claude Code skill,
  (2) Scaffold a skill directory structure with templates,
  (3) Convert existing scripts or workflows into packaged skills,
  (4) Analyze a codebase and extract reusable skill patterns,
  (5) Refactor a monolithic skill into progressive disclosure structure.
---

# Skill Generator

## Core Concepts

**Research before you generate**: Every skill starts with a research phase. Before asking detailed questions or choosing a structure, investigate the domain -- web search for best practices, scan github for SKILLS, for related patterns, and search the codebase for existing conventions. This grounds the skill in real knowledge rather than surface-level assumptions.

**Skills use a 3-level progressive disclosure structure**: SKILL.md is always loaded when the skill triggers -- it teaches core knowledge inline. metadata.json holds trigger phrases for tooling/discovery only. rules/*.md are reference files consulted on demand, not loaded by default. Larger skills add references/ for domain-specific documentation and scripts/ for executable automation.

```
skills/my-skill/
├── SKILL.md           # Always loaded -- frontmatter + core concepts + reference list
├── metadata.json      # Tooling only -- { "triggers": [...] }
├── references/        # (optional) Documentation loaded on demand
├── scripts/           # (optional) Executable automation
└── rules/
    ├── _template.md   # Template for adding new rules
    └── rule-name.md   # Avoid/Prefer examples, no frontmatter
```

**SKILL.md frontmatter is lean, body is rich**: Frontmatter contains only `name` and `description`. The description is the primary trigger mechanism -- write 100+ words with specific "Use when" scenarios. The body teaches the 2-3 most important concepts inline with code examples. The reference section lists rule files with "when to read" guidance. No duplication between frontmatter and body.

```yaml
---
name: my-skill
description: >
  Validates API responses for type safety and error handling. Use when
  working with REST endpoints for: (1) Checking response shapes against
  schemas, (2) Verifying error response formats, (3) Testing endpoint
  behavior under edge cases, or any API quality task.
---
```

**Rule files have no frontmatter -- just title, explanation, and avoid/prefer examples**: Each rule focuses on one concept. The title states what to do (imperative). The description explains why. The avoid/prefer sections show concrete examples.

```markdown
# Validate inputs at system boundaries

Internal functions can trust their callers, but functions that accept
user input, API data, or file contents need validation.

## Avoid

// Bad: Trusts external input
function handleWebhook(body: any) {
  db.insert(body.event, body.data);
}

## Prefer

// Good: Validates at the boundary
function handleWebhook(body: unknown) {
  const event = parseWebhookEvent(body);
  if (!event.ok) return { error: event.error };
  db.insert(event.data.type, event.data.payload);
}
```

## Decision Framework

Choose the skill structure based on content size and domain complexity:

```
How much content does the skill need?
├── Under 200 lines total?
│   └── Self-contained: Everything in SKILL.md + rules/
├── 200-500 lines, single domain?
│   └── Guide + references: Core workflow in SKILL.md, details in references/
├── Multiple independent domains or frameworks?
│   └── Navigation hub: SKILL.md routes to domain-specific references/
└── Includes executable automation?
    └── Add scripts/ for deterministic, reusable operations
```

Choose the degree of freedom for each rule based on task fragility:

```
How fragile is the task?
├── Multiple valid approaches, context-dependent?
│   └── High freedom: Text-based guidance, loose recommendations
├── Preferred pattern exists, some variation OK?
│   └── Medium freedom: Parameterized templates, pseudocode
└── Fragile operation, consistency critical?
    └── Low freedom: Exact scripts, strict step sequences
```

Think of Claude as exploring a path: a narrow bridge with cliffs needs specific guardrails (low freedom), while an open field allows many valid routes (high freedom). Most skills have a mix -- commit message formatting is high freedom, PDF rotation is low freedom. See `rules/degrees-of-freedom.md` for side-by-side examples of all three levels.

## Progressive Disclosure Patterns

Three established patterns for organizing content beyond SKILL.md. The context window is a public good -- skills share it with system prompts, conversation history, and user requests. Default assumption: Claude is already very smart. Only add context Claude does not already have.

**Pattern 1 -- High-level guide with references**: Keep the core workflow in SKILL.md, move advanced features to reference files. Best for skills with a simple core plus optional depth.

```markdown
# PDF Processing
## Quick start
Extract text with pdfplumber: [core code example]
## Advanced features
- **Form filling**: See references/forms.md for complete guide
- **API reference**: See references/api.md for all methods
```

**Pattern 2 -- Domain-specific organization**: SKILL.md acts as a navigation hub, each domain/variant gets its own reference file. Best for multi-framework or multi-domain skills. Claude loads only the relevant domain file.

```
cloud-deploy/
├── SKILL.md (workflow + provider selection)
└── references/
    ├── aws.md (AWS-specific patterns)
    ├── gcp.md (GCP-specific patterns)
    └── azure.md (Azure-specific patterns)
```

**Pattern 3 -- Conditional details**: Basic instructions in SKILL.md, advanced content linked for when the user explicitly needs it. Best for skills with basic and advanced modes.

```markdown
## Creating documents
Use docx-js for new documents. See references/docx-js.md.
## Editing documents
For simple edits, modify the XML directly.
**For tracked changes**: See references/redlining.md
```

Keep SKILL.md under 500 lines. If references are large (>10k words), include grep search patterns in SKILL.md. Avoid deeply nested references -- keep everything one level deep from SKILL.md. See `rules/progressive-disclosure.md` for full guidance.

## Quick Patterns

When generating a skill, follow this sequence:

1. **Gather initial scope** -- Get the skill name (kebab-case) and a brief description of what it should do. Don't ask for triggers, structure, or rules yet -- that comes after research
2. **Research the domain** -- Before asking detailed questions, investigate the domain thoroughly. Web search for best practices, common patterns, and pitfalls. Search github for related skills. Search the codebase for existing conventions or utilities. Identify key concepts an expert would consider non-obvious. Compile a brief (5-10 bullet) research summary and share it with the user. See `rules/research-gathering.md` for the full research protocol
3. **Clarifying Q&A** -- Using research findings, ask targeted questions. Present discovered patterns and ask which apply. Ask about scope boundaries (what's in vs. out), edge cases the research surfaced, the target audience, and preferred degree of freedom (strict guardrails vs. flexible guidance). Use `AskUserQuestion` for structured choices where possible. Iterate until confident (2-3 rounds max)
4. **Choose structure** -- Use the decision framework above to pick self-contained, guide + references, or navigation hub
5. **Identify 3-6 rules** -- Each rule = one concept with avoid/prefer examples. Analyze concrete use cases: "How would I execute this from scratch? What would be non-obvious?"
6. **Assign degrees of freedom** -- Match each rule's specificity to its task fragility (high/medium/low). Fragile operations (file format manipulation, API protocols) need low freedom. Flexible tasks (writing, architecture choices) need high freedom
7. **Pick 2-3 rules as core knowledge** -- The highest-priority rules get inlined in SKILL.md. Core knowledge should answer: "What does Claude need to know on every activation?"
8. **Search the codebase for patterns** -- Look for domain-relevant conventions, existing skills, or config files to ground the rules in real usage rather than generic placeholders
9. **Generate files** -- Create the directory structure with all files. Use `scripts/init-skill.ts` to scaffold, or create manually. If the skill includes scripts, test them before finalizing
10. **Validate** -- Run `scripts/validate-skill.ts` to check structure, or manually verify: SKILL.md exists with 100+ word description, rules have no frontmatter and use Avoid/Prefer format, all referenced files exist

Output goes to the `skills/<skill-name>/` directory (or wherever the user specifies).

## What Not to Include

A skill should only contain files that directly support its functionality. Do not create:

- README.md, CHANGELOG.md, or INSTALLATION_GUIDE.md
- Test files or CI configuration
- User-facing documentation (skills are for AI agents, not humans)
- Duplicate information between SKILL.md and reference files

If information lives in references/, do not repeat it in SKILL.md. The body is only loaded after triggering, so "When to Use This Skill" sections in the body are wasted -- put all trigger criteria in the frontmatter description instead.

## Verification Checklist

Before finalizing a generated skill:

- [ ] SKILL.md has frontmatter with `name` and `description` only
- [ ] Description is 100+ words with "Use when" scenarios
- [ ] Name is kebab-case, matches the directory name
- [ ] Rule files have no YAML frontmatter
- [ ] Rule files use ## Avoid and ## Prefer sections
- [ ] All files referenced in SKILL.md actually exist
- [ ] SKILL.md is under 500 lines
- [ ] No placeholder text remaining ([TODO:] markers)

## Skill Self-Improvement

**Every time this skill is used, you MUST evaluate whether the skill files need updating.**

After generating or reviewing a skill, examine what happened — mistakes, gaps, new patterns, or non-obvious lessons — and improve the skill:

**Where to put findings — you decide:**

1. **Existing file fits?** → Add to the most relevant `rules/*.md`, `references/*.md`, or `SKILL.md` section
2. **New concept that deserves its own rule?** → Create a new `rules/<rule-name>.md` following the Avoid/Prefer format (see `rules/_template.md`) and add it to the Reference Files list in `SKILL.md`
3. **New reference material (templates, workflow patterns)?** → Create a new `references/<name>.md` and add it to the Reference Files list in `SKILL.md`
4. **Core workflow change?** → Edit `SKILL.md` directly — update the relevant section or add a new one

**Guidelines:**
- Be concise — one bullet or ⚠️ **Gotcha:** callout per finding
- Don't duplicate — if the lesson is already documented, skip it
- New rule files: imperative title, explain why, then `## Avoid` / `## Prefer` with concrete examples
- After editing, briefly tell the user: *"I've also updated the skill with this finding so future sessions won't hit the same issue."*

---

## Available Scripts

- `scripts/init-skill.ts` -- Scaffold a new skill directory with TODO-filled templates. Run: `bun scripts/init-skill.ts <name> [--output <dir>]`
- `scripts/validate-skill.ts` -- Check structure, frontmatter, naming, description length, rule format. Run: `bun scripts/validate-skill.ts <path>`
- `scripts/analyze-skill.ts` -- Report line counts, rule count, description words, missing sections, token estimate. Run: `bun scripts/analyze-skill.ts <path>`

## Reference Files

Consult these only when you need specific details:

- `rules/skill-md-format.md` -- when writing the SKILL.md content and frontmatter
- `rules/rule-file-format.md` -- when writing individual rule files with avoid/prefer examples
- `rules/sample-pattern-analysis.md` -- when incorporating patterns from existing code or reference examples
- `rules/decision-frameworks.md` -- when adding ASCII decision trees to route users to the right pattern
- `rules/degrees-of-freedom.md` -- when deciding how strict or loose each rule should be
- `rules/trigger-descriptions.md` -- when writing comprehensive 100+ word trigger descriptions
- `rules/progressive-disclosure.md` -- when choosing how to split content across SKILL.md and reference files
- `references/output-patterns.md` -- when you need complete file templates with [TODO:] markers for any skill structure
- `rules/research-gathering.md` -- when planning the research and Q&A phase before generating a skill
- `references/workflow-patterns.md` -- when structuring multi-step processes (sequential, conditional, feedback-loop, checklist)
