# Check the shared registry before writing new findings

Without deduplication, parallel researchers inevitably discover the same popular answers. The registry file is the single source of truth — every researcher must read it before each search and after finding new information. If a finding is already covered (even with different wording), skip it and explore a new direction.

## Avoid

```
// Bad: Researcher writes findings without checking

Researcher 3 finds "Use Redis for session storage" and writes it to registry.
Researcher 1 already wrote "Redis-backed sessions for horizontal scaling".
→ Duplicate finding, wasted a research slot.

// Bad: Registry has no structure, hard to scan

## Findings
Redis is good for sessions. Also found that JWT works well.
Someone mentioned Postgres for sessions too. WebSockets are fast.
→ No IDs, no source, no structure — impossible to dedup quickly.
```

## Prefer

```
// Good: Check-before-write protocol

Before EACH new finding:
1. Read the full registry file
2. Scan all existing entries by summary and keywords
3. If the finding is already covered → skip, note it, explore elsewhere
4. If the finding adds NEW information to an existing entry → append to that entry
5. If the finding is genuinely new → add a new entry

// Good: Structured registry format

## Findings Registry: {topic}

### [R1-3] Redis Session Store (Researcher 3)
- **Angle**: Infrastructure scaling
- **Source**: web search — "distributed session store patterns"
- **Summary**: Redis provides in-memory session storage with TTL support,
  enabling horizontal scaling across multiple app instances.
- **Strength**: Sub-millisecond reads, built-in expiry, cluster mode
- **Weakness**: Additional infrastructure, memory cost, data loss on restart
- **Keywords**: redis, session, distributed, scaling, in-memory

### [R2-1] JWT Stateless Authentication (Researcher 2)
- **Angle**: Protocol deep-dive
- **Source**: web search — "JWT vs session authentication 2025"
- **Summary**: JWTs encode claims in the token itself, eliminating
  server-side session storage entirely.
- **Strength**: No server state, works across microservices, offline-verifiable
- **Weakness**: Can't revoke individual tokens, payload size, clock skew
- **Keywords**: jwt, stateless, token, claims, microservices
```

## Registry Entry Format

Each entry must include:
- **ID**: `[R{researcher}-{sequence}]` — tracks who found what
- **Angle**: Which search angle produced this finding
- **Source**: `web search — "{query}"` or `codebase — "{file/pattern}"`
- **Summary**: 2-3 sentences describing the finding
- **Strength**: Key advantage
- **Weakness**: Key drawback
- **Keywords**: 5-8 terms for dedup scanning

The keywords field is critical — researchers scan keywords to detect overlap even when summaries use different wording.
