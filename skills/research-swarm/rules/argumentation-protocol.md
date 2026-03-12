# Run structured debate rounds for contested findings

Unstructured debate devolves into the loudest voice winning. Structured debate ensures every researcher speaks exactly once per round, arguments address the finding (not each other), and the lead moderates without voting. Debate rounds resolve ties and contested findings that scored between 5.0-6.9.

## Avoid

```
// Bad: Free-form debate with no structure

Lead: "What do you all think about Finding F3?"
R1: "I think it's great"
R3: "No, F5 is better"
R2: "I agree with R3"
R1: "But you didn't even consider..."
R4: "Can we move on?"

→ No clear outcome, dominated by assertive voices, no evidence cited
```

## Prefer

```
// Good: Structured debate round

DEBATE ROUND: F3 (Redis Sessions) vs F5 (JWT Stateless)
Both scored 6.8 average — within 0.5 points, triggering tie-break.

Lead moderates. Researchers speak in order. Each gets ONE statement.

Round 1 — Opening arguments (one per researcher):
  R1: "F3 fits our architecture — we already use Redis for caching.
       Adding sessions is zero new infrastructure." [evidence: codebase]
  R2: "F5 eliminates a failure point. If Redis goes down, all sessions
       are lost. JWTs survive any single-server failure." [evidence: resilience]
  R3: "F3 gives us revocation. With JWT we can't log out a compromised
       user until the token expires." [evidence: security]
  R4: "F5 scales better for our API-first architecture — no session
       affinity needed across 12 services." [evidence: scale]
  R5: "Both work. But F3 has lower migration cost — our auth middleware
       already uses express-session." [evidence: codebase]

Round 2 — Final vote (revised scores):
  R1: F3=8, F5=6  |  R2: F3=6, F5=8  |  R3: F3=9, F5=5
  R4: F3=6, F5=8  |  R5: F3=7, F5=7

Tally: F3 avg=7.2, F5 avg=6.8
Result: F3 (Redis Sessions) wins the tie-break.

Dissent noted: R2 and R4 preferred F5 — include their scaling and
resilience arguments in the final synthesis as caveats.
```

## Debate Rules

1. **One statement per researcher per round** — no back-and-forth
2. **Evidence required** — every argument must cite a source (web link, codebase file, or prior finding)
3. **Address the finding, not other researchers** — "F3 has X advantage" not "R1 is wrong because"
4. **Lead does not vote** — the lead moderates, tallies, and documents
5. **Maximum 2 rounds** — if still tied after 2 rounds, the lead decides with documented reasoning
6. **Dissent is preserved** — minority opinions are included in the final synthesis, not discarded
