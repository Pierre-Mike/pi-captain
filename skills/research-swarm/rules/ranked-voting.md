# Score findings 1-10 with mandatory justification

Without a scoring rubric, "7" means different things to different researchers. A standardized scale ensures scores are comparable. Every score must include a one-sentence justification — scores without reasoning are not counted. This forces researchers to articulate their position rather than giving gut reactions.

## Avoid

```
// Bad: Scores without justification or inconsistent scale

Researcher 1 scorecard:
  F1: 8
  F2: 3
  F3: 7

→ No justification. Is 8 "good" or "great"? Why was F2 scored 3?
   Impossible to reconcile with other researchers or detect bias.
```

## Prefer

```
// Good: Calibrated scores with one-sentence justifications

Researcher 1 scorecard:
  F1 (Redis Sessions): 8 — "Proven at scale, we already run Redis,
    minimal migration effort."
  F2 (Flat-file sessions): 3 — "Won't scale past 100 concurrent users,
    no distributed support."
  F3 (JWT Stateless): 7 — "Good for API-first, but revocation story
    is a real security concern."
  F4 (Passkeys/WebAuthn): 5 — "Promising but browser support is still
    uneven; high migration cost."
  F5 (Session in Postgres): 6 — "Works but adds latency to every
    request; not ideal for real-time."
```

## Scoring Rubric

| Score | Meaning | When to use |
|-------|---------|-------------|
| 9-10 | **Strong recommend** | Clearly the best option, strong evidence, low risk |
| 7-8 | **Recommend** | Good option with known trade-offs, solid evidence |
| 5-6 | **Neutral/contested** | Could work but has significant concerns or unknowns |
| 3-4 | **Lean against** | Serious drawbacks that likely outweigh benefits |
| 1-2 | **Reject** | Fundamentally flawed, wrong fit, or insufficient evidence |

## Tally Rules

1. Collect scorecards from all 5 researchers
2. For each finding, calculate: `average = sum(scores) / 5`
3. Categorize:
   - **Accepted**: average >= 7.0
   - **Contested**: average 5.0 - 6.9 → goes to debate round
   - **Rejected**: average < 5.0
4. **Tie detection**: two accepted findings within 0.5 points of each other → debate round
5. **Outlier detection**: if one score is 3+ points from the average, the lead asks that researcher to elaborate before tallying

## Bias Checks

Before tallying, the lead scans for these patterns:
- **Anchoring**: Did all researchers score similarly to whoever posted first? If yes, discount the first scorecard's influence
- **Own-finding bias**: Did researchers systematically score their own findings higher? If yes, exclude self-scores from the average
- **Halo effect**: Did one strong finding inflate scores for related findings? If yes, evaluate related findings independently
