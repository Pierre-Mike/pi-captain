---
name: research-swarm
description: >
  Orchestrates parallel research across a team of 5 agents, each exploring
  a different angle of the same question using web search and codebase
  exploration. Prevents duplicate work through a shared findings registry.
  After all researchers complete, runs a democratic argumentation phase
  where every researcher scores all findings 1-10 and argues for or against
  each. The lead tallies scores, resolves ties through debate rounds, and
  synthesizes the highest-ranked findings into a final answer. Use when:
  (1) Researching a complex question that benefits from multiple perspectives,
  (2) Comparing solutions, libraries, or architectural approaches,
  (3) Investigating a bug or issue from different angles simultaneously,
  (4) Gathering evidence for a technical decision with team consensus,
  (5) Any research task where breadth, deduplication, and democratic
  evaluation produce better results than a single-agent search.
---

# Research Swarm

## Core Concepts

**One question, five angles**: The lead transforms a single research question into 5 distinct search strategies — each researcher gets unique terms, framing, or source types. This prevents redundant searches and maximizes coverage. The angles should span different dimensions: terminology variations, domain perspectives, historical vs current, theoretical vs practical, mainstream vs contrarian.

```
Research question: "Best approach for real-time updates in our app?"

Researcher 1: "WebSocket implementation patterns Node.js 2025"
  → Focus: WebSocket deep-dive, protocol-level

Researcher 2: "Server-Sent Events vs WebSocket comparison"
  → Focus: SSE as alternative, trade-offs

Researcher 3: "real-time push notification architecture scalability"
  → Focus: Infrastructure and scaling concerns

Researcher 4: [Codebase] Grep for existing socket/event/push patterns
  → Focus: What the codebase already does

Researcher 5: "long polling MQTT gRPC streaming alternatives WebSocket"
  → Focus: Less common alternatives, contrarian view
```

**Shared findings registry prevents duplicate work**: All researchers write to a single shared file (`.claude/plans/research-{topic}-registry.md`). Before starting a new search, each researcher checks the registry. If a finding already exists, they skip it and explore a different angle. The registry uses a structured format so entries are scannable.

```markdown
## Findings Registry: real-time-updates

### [R1] WebSocket with Socket.io
- **Source**: web search
- **Summary**: Socket.io abstracts WebSocket with fallback to polling...
- **Strength**: Mature, well-documented, auto-reconnect
- **Weakness**: 80KB bundle, vendor lock-in on protocol

### [R3] Server-Sent Events (SSE)
- **Source**: web search
- **Summary**: Native browser API, unidirectional server→client...
- **Strength**: No library needed, HTTP/2 compatible
- **Weakness**: No client→server, limited browser connection pool
```

**Democratic scoring with argumentation**: After research completes, every researcher reads ALL findings (not just their own) and scores each 1-10 with a one-sentence argument. The lead tallies scores. Findings scoring >= 7.0 average advance. Ties (within 0.5 points) trigger a structured debate round where tied-finding advocates present their case and the full team re-votes.

## Workflow

### Phase 1: Define — Lead formulates angles

1. Receive the research question from the user
2. Generate 5 distinct search angles (vary terms, perspective, source type)
3. Assign at least one angle to codebase exploration (Grep/Glob/Read)
4. Write the question and angles to `.claude/plans/research-{topic}.md`
5. Create the empty findings registry: `.claude/plans/research-{topic}-registry.md`

### Phase 2: Dispatch — Spawn 5 researcher agents

Launch all 5 in a **single message** (parallel execution):

```
TeamCreate("research-{topic}")

Task(team_name="research-{topic}", name="researcher-1", subagent_type="general-purpose",
  prompt="Research angle: {angle-1}. Write findings to the shared registry.
          Check registry before each search to avoid duplicates.")

Task(team_name=..., name="researcher-2", ...)
Task(team_name=..., name="researcher-3", ...)
Task(team_name=..., name="researcher-4", ...)
Task(team_name=..., name="researcher-5", ...)
```

Each researcher receives:
- The original question for context
- Their specific angle and search terms
- The registry file path
- Instructions to check-before-write

### Phase 3: Research — Parallel exploration with dedup

Each researcher independently:
1. Read the registry to see what's already found
2. Search their assigned angle (web, codebase, or both)
3. For each finding, check the registry again — if covered, skip
4. Write new findings to the registry in the structured format
5. Send a message to the lead when done: `"Done. Added N findings to registry."`

See `rules/dedup-registry.md` for the exact check-before-write protocol.

### Phase 4: Gather — Lead consolidates

1. Wait for all 5 researchers to report completion
2. Read the full registry
3. Deduplicate any remaining overlaps (different wording, same finding)
4. Number all unique findings [F1] through [FN]
5. Write the consolidated list to `.claude/plans/research-{topic}-consolidated.md`

### Phase 5: Argue — Democratic scoring

Send the consolidated findings to all 5 researchers with voting instructions:

```
SendMessage(type="broadcast", content="
  Review all findings in research-{topic}-consolidated.md.
  For EACH finding, provide:
  - Score: 1-10 (10 = strongly recommend, 1 = reject)
  - Argument: One sentence explaining your score
  Reply with your full scorecard.")
```

Each researcher reads ALL findings and submits scores. See `rules/ranked-voting.md` for the scoring rubric.

### Phase 6: Vote — Tally and resolve ties

1. Collect all 5 scorecards
2. Calculate average score per finding
3. Findings with average >= 7.0 → **accepted**
4. Findings with average < 5.0 → **rejected**
5. Findings between 5.0-6.9 → **contested** (need debate)
6. If two accepted findings are within 0.5 points → **tied** (need debate)

For contested/tied findings, run a debate round. See `rules/argumentation-protocol.md`.

### Phase 7: Synthesize — Lead produces final output

1. Rank accepted findings by average score
2. Combine top findings into a coherent answer
3. Note any contested findings that were resolved by debate
4. Include dissenting views (any researcher who scored an accepted finding < 5)
5. Present to the user with the full ranking and key arguments
6. **Always provide the full absolute path** to the final research document so the user can easily open it (e.g. with `glow`)

## Skill Self-Improvement

**Every time this skill is used, you MUST evaluate whether the skill files need updating.**

After completing a research swarm, examine what happened — mistakes, gaps, new patterns, or non-obvious lessons — and improve the skill:

**Where to put findings — you decide:**

1. **Existing file fits?** → Add to the most relevant `rules/*.md`, `references/*.md`, or `SKILL.md` section
2. **New concept that deserves its own rule?** → Create a new `rules/<rule-name>.md` following the Avoid/Prefer format (see `rules/_template.md`) and add it to the Reference Files list in `SKILL.md`
3. **New reference material (team patterns, protocol details)?** → Create a new `references/<name>.md` and add it to the Reference Files list in `SKILL.md`
4. **Core workflow change?** → Edit `SKILL.md` directly — update the relevant section or add a new one

**Guidelines:**
- Be concise — one bullet or ⚠️ **Gotcha:** callout per finding
- Don't duplicate — if the lesson is already documented, skip it
- New rule files: imperative title, explain why, then `## Avoid` / `## Prefer` with concrete examples
- After editing, briefly tell the user: *"I've also updated the skill with this finding so future sessions won't hit the same issue."*

---

## Reference Files

Consult these only when you need specific details:

- `rules/search-diversification.md` — when generating the 5 distinct search angles from one question
- `rules/dedup-registry.md` — when setting up the shared findings file and check-before-write protocol
- `rules/argumentation-protocol.md` — when running structured debate rounds for contested findings
- `rules/ranked-voting.md` — when tallying scores, handling ties, and determining acceptance thresholds
- `rules/synthesis.md` — when combining ranked findings into the final deliverable
- `references/team-setup.md` — when wiring up TeamCreate, Task spawning, and SendMessage patterns
