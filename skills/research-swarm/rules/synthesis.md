# Synthesize ranked findings into a final answer that preserves all voices

The synthesis is not a summary — it's a structured argument built from democratically ranked evidence. If the lead cherry-picks findings or drops dissenting views, the entire democratic process was theater. The final output must reflect the scoring, include minority opinions, and clearly separate consensus from contested points.

## Avoid

```
// Bad: Lead picks their favorite and ignores the vote

After voting, F1 scored 8.2 and F3 scored 7.4.
Lead writes: "The team recommends F3 because it's more modern."

→ Ignores the democratic result. F1 won. F3 was second.
   Lead's preference overrode the team vote.

// Bad: Dissent is dropped

R4 scored F1 a 4 (everyone else scored 8-9).
Final report doesn't mention R4's concern.

→ R4's low score signaled a real risk. Dropping it means the
   user doesn't know about a potential problem one expert flagged.
```

## Prefer

```
// Good: Synthesis reflects the full democratic result

## Research Results: Authentication Approach

### Recommendation: Redis Sessions (F1)
**Score: 8.2/10** (Accepted by consensus)

Redis-backed sessions provide sub-millisecond reads, built-in TTL for
expiry, and integrate with our existing Redis cluster. Migration cost
is low — our express-session middleware already supports Redis stores.

**Supporting arguments:**
- R1 (8): "Proven at scale, minimal migration effort"
- R3 (9): "Gives us server-side revocation — critical for security"
- R5 (8): "Lowest migration cost, express-session already compatible"

**Dissenting view:**
- R4 (4): "Single point of failure — if Redis cluster goes down,
  ALL users are logged out simultaneously. Need a fallback strategy."

**Lead note:** R4's concern is valid. If adopting F1, add a Redis
sentinel/failover configuration to the implementation plan.

### Runner-up: JWT Stateless (F3)
**Score: 7.4/10** (Accepted)

Viable alternative if the architecture moves to distributed
microservices where session affinity is impractical.

### Rejected: Flat-file Sessions (F2)
**Score: 2.8/10** (Rejected by consensus)
Does not scale beyond single-server deployments.
```

## Synthesis Structure

The final document must include:

1. **Recommendation** — Highest-scored accepted finding with supporting arguments
2. **Dissenting views** — Any researcher who scored the recommendation < 5, with their reasoning
3. **Runner-up(s)** — Other accepted findings ranked by score
4. **Contested findings** — Debate outcomes with final vote tallies
5. **Rejected findings** — Brief note on what was ruled out and why
6. **Open questions** — Anything the research didn't resolve

## Lead's Role in Synthesis

The lead:
- Organizes but does not editorialize
- Adds "Lead note" only when connecting findings or flagging practical implications
- Never overrides the democratic ranking
- Preserves exact quotes from researcher arguments
- Clearly labels consensus vs contested vs rejected
