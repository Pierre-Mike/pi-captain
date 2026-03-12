# Generate 5 distinct search angles from one question

If all researchers search the same terms, you get 5x the cost for 1x the coverage. Each angle must differ on at least two dimensions: terminology, perspective, source type, or scope. One angle must always be assigned to codebase exploration.

## Avoid

```
Question: "How to handle authentication?"

Researcher 1: "authentication best practices"
Researcher 2: "authentication implementation guide"
Researcher 3: "authentication tutorial"
Researcher 4: "how to do authentication"
Researcher 5: "authentication patterns"

// Bad: All five are synonyms — same results, wasted parallel capacity
```

## Prefer

```
Question: "How to handle authentication?"

Researcher 1: "JWT vs session-based authentication trade-offs 2025"
  → Dimension: Technology comparison, current year
  → Source: Web search

Researcher 2: "OAuth 2.0 PKCE flow implementation Node.js"
  → Dimension: Specific protocol deep-dive
  → Source: Web search

Researcher 3: "authentication security vulnerabilities OWASP top 10 session"
  → Dimension: Security/adversarial perspective
  → Source: Web search

Researcher 4: [Codebase] Search for existing auth middleware, token handling,
  session stores, login routes, auth config
  → Dimension: What already exists in the project
  → Source: Grep/Glob/Read

Researcher 5: "passwordless authentication passkeys WebAuthn adoption"
  → Dimension: Emerging/contrarian alternatives
  → Source: Web search
```

## Angle Generation Framework

Apply these 5 lenses to any research question:

1. **Mainstream** — The most common/popular approach (high-traffic search terms)
2. **Deep technical** — Protocol-level or implementation-specific detail
3. **Security/risk** — What can go wrong, adversarial perspective
4. **Existing state** — What the codebase already does (always codebase exploration)
5. **Contrarian/emerging** — Less common alternatives, new approaches, what most people overlook

If the question doesn't fit all 5 lenses, adapt:
- For library comparison: one researcher per candidate library
- For debugging: one per hypothesis (race condition, config error, dependency conflict, etc.)
- For architecture: one per architectural pattern (monolith, microservice, serverless, etc.)
