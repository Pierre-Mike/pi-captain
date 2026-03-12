# Team Setup Reference

Exact Claude Code API patterns for creating and coordinating the research swarm.

## Phase 1: Create Team and Registry

```javascript
// Lead creates the team
TeamCreate("research-{topic}")

// Lead creates the empty registry file
Write({
  file_path: ".claude/plans/research-{topic}-registry.md",
  content: "## Findings Registry: {topic}\n\n_No findings yet._\n"
})
```

## Phase 2: Spawn 5 Researchers in Parallel

All 5 must be spawned in a **single message** (one response with 5 Task calls):

```javascript
// All 5 Task calls in ONE message for true parallel execution
Task({
  team_name: "research-{topic}",
  name: "researcher-1",
  subagent_type: "general-purpose",
  description: "Research angle 1: mainstream",
  prompt: `You are Researcher 1 in a research swarm investigating: "{question}"

Your assigned angle: {angle-1-description}
Search terms: {angle-1-terms}

PROTOCOL:
1. Read .claude/plans/research-{topic}-registry.md before every search
2. Search your angle using WebSearch and WebFetch
3. For each finding, check the registry keywords for overlap
4. If new: add to registry using the entry format below
5. If duplicate: skip and explore a different direction
6. When done: send message to lead with count of findings added

REGISTRY ENTRY FORMAT:
### [R1-{N}] {Title} (Researcher 1)
- **Angle**: {your angle}
- **Source**: web search — "{query used}"
- **Summary**: 2-3 sentences
- **Strength**: Key advantage
- **Weakness**: Key drawback
- **Keywords**: 5-8 terms for dedup`
})

// Researcher 2-5 follow the same pattern with different angles
// Researcher 4 should always be the codebase explorer:

Task({
  team_name: "research-{topic}",
  name: "researcher-4",
  subagent_type: "general-purpose",
  description: "Research angle 4: codebase",
  prompt: `You are Researcher 4 in a research swarm investigating: "{question}"

Your assigned angle: Explore the existing codebase for relevant patterns.

PROTOCOL:
1. Read .claude/plans/research-{topic}-registry.md
2. Use Grep, Glob, and Read to find existing code related to the question
3. Document what the codebase already does, what patterns exist, what's missing
4. Add findings to the registry
5. When done: send message to lead`
})
```

## Phase 3: Monitor Completion

Researchers send messages automatically when done. The lead receives them as they arrive.

```
// Researcher messages arrive automatically — no polling needed
// Lead waits for all 5 "Done" messages before proceeding
```

## Phase 4: Broadcast Voting Instructions

```javascript
SendMessage({
  type: "broadcast",
  content: `VOTING PHASE — Read .claude/plans/research-{topic}-consolidated.md

For EACH finding (F1 through F{N}), reply with:

F1: {score}/10 — "{one-sentence justification}"
F2: {score}/10 — "{one-sentence justification}"
...

SCORING RUBRIC:
9-10: Strong recommend (best option, strong evidence)
7-8: Recommend (good option, known trade-offs)
5-6: Neutral (could work, significant concerns)
3-4: Lean against (serious drawbacks)
1-2: Reject (fundamentally flawed)

Reply with your FULL scorecard in a SINGLE message.`,
  summary: "Vote on all research findings"
})
```

## Phase 5: Debate Round (if needed)

```javascript
// Only for contested (5.0-6.9) or tied findings
SendMessage({
  type: "broadcast",
  content: `DEBATE ROUND: F3 vs F5 (tied at 6.8)

Rules:
- ONE statement per researcher
- Must cite evidence (source, file, or prior finding)
- Address the finding, not other researchers
- Lead does not vote

After all statements: submit REVISED scores for F3 and F5 only.`,
  summary: "Debate round for tied findings"
})
```

## Phase 6: Shutdown

```javascript
// After synthesis is complete, shut down all researchers
SendMessage({ type: "shutdown_request", recipient: "researcher-1", content: "Research complete" })
SendMessage({ type: "shutdown_request", recipient: "researcher-2", content: "Research complete" })
// ... repeat for all 5
// After all shut down:
TeamDelete()
```
