# Research the domain before generating a skill

Skills grounded in real domain research are more accurate and useful than skills based on surface-level requirements. A one-line description like "generate a skill for API testing" hides dozens of decisions -- authentication patterns, status code handling, rate limiting, schema validation, mocking strategies. Research surfaces these before you commit to a structure.

## Research checklist

Before asking detailed questions, complete these steps:

1. **Web search** -- Search for best practices, common patterns, and known pitfalls in the domain. Look for authoritative sources (official docs, well-known blog posts, conference talks)
2. **Sample analysis** -- Search `samples/` for related skills, agents, or configurations that already cover part of the domain
3. **Codebase scan** -- Search the current project for existing conventions, utilities, or config files related to the domain
4. **Non-obvious concepts** -- Identify 3-5 things an expert would know that a generalist might miss
5. **Research summary** -- Compile 5-10 bullets and share them with the user before asking detailed questions

## Avoid

```
User: "Generate a skill for database migrations"

Agent: "What's the skill name? What are 3-5 trigger scenarios?
What rules should it have?"
```

Jumping straight to structure questions without understanding the domain produces generic, shallow skills. The agent doesn't know whether the user means SQL migrations, NoSQL schema changes, ORM-managed migrations, or manual scripts -- and each has different best practices.

## Avoid

```
User: "Generate a skill for API testing"

Agent: *generates immediately from the one-line description*
```

Skipping research entirely produces skills that miss critical domain concepts like authentication flows, rate limit handling, or contract testing.

## Prefer

```
User: "Generate a skill for database migrations"

Agent: "Got it -- a skill for database migrations. Let me research
the domain first."

*Web searches for database migration best practices*
*Searches samples/ for existing migration-related skills*
*Searches codebase for migration utilities or ORM config*

Agent: "Here's what I found:
- Migrations should be idempotent and reversible
- Lock management prevents concurrent migration conflicts
- Data migrations vs. schema migrations need different strategies
- Popular tools: Prisma Migrate, Knex, golang-migrate, Flyway
- Common pitfall: large table migrations blocking production reads

A few questions based on this research:
1. Which migration tool/ORM are you using? (Prisma / Knex / raw SQL / other)
2. Do you need data migration support or just schema changes?
3. Should the skill cover rollback strategies?
4. What's your deployment model -- CI-triggered or manual?"
```

Research-informed questions are specific, relevant, and help the user think about decisions they might not have considered.

## Prefer

```
Agent: *after completing research*

"Based on my research, here are patterns I found in existing samples:
- samples/vercel-agent-skills uses strict step sequences for
  file-format operations (low freedom)
- samples/agentic-flow defines clear scope boundaries in frontmatter

Which of these patterns feel right for your use case?"
```

Referencing real patterns from samples grounds the conversation in concrete examples rather than abstract choices.

## Example question sets by domain type

**Developer tooling** (linters, formatters, CI): Ask about target language/framework, existing tool configs, team size, strictness preferences.

**API/integration skills**: Ask about auth method, rate limits, error handling strategy, sync vs. async, schema validation approach.

**Content/writing skills**: Ask about tone, audience, format constraints, review workflow, brand guidelines.

**Infrastructure skills**: Ask about cloud provider, IaC tool, environment strategy (dev/staging/prod), security requirements.
