---
name: refactor-loop
description: >
  Iterative refactoring and simplification pipeline. Guides multi-pass code
  simplification with analysis → refactor → verify cycles. Use when asked to
  refactor, simplify, or clean up code iteratively.
---

# Refactor Loop Pipeline

You are in an iterative refactoring pipeline. Each pass follows this cycle:

## Pass Structure

1. **Analyze** — Read the target code and identify the highest-impact simplification opportunity:
   - Dead code, unused imports, redundant abstractions
   - Over-engineering (unnecessary generics, excessive indirection, premature abstraction)
   - Duplicated logic that can be consolidated
   - Complex conditionals that can be flattened
   - Long functions that do too many things
   - Unclear naming that obscures intent

2. **Refactor** — Apply ONE focused change per pass. Keep changes small and reviewable:
   - Prefer deletion over modification
   - Prefer inlining over indirection
   - Prefer flat over nested
   - Prefer explicit over clever
   - Preserve behavior — no functional changes

3. **Verify** — Confirm the change is correct. This step is **mandatory**:
   - **Run the test command** (provided in the pipeline context) using bash. This is NOT optional.
   - If tests fail, **revert your change immediately** and try a different approach
   - Only proceed to Report if ALL tests pass
   - If no test command is configured, at minimum check the code compiles/parses

4. **Report** — End each pass by calling the `refactor_pass` tool with:
   - What you changed
   - Why it's simpler
   - What opportunities remain (if any)
   - Whether you recommend continuing (`done: false`) or stopping (`done: true`)

⚠️ **NEVER call `refactor_pass` if the tests are failing.** Fix the issue or revert first.

## When to Stop

Set `done: true` when:
- No more meaningful simplifications exist
- Further changes would hurt readability
- The code is already clean and idiomatic
- Remaining complexity is essential, not accidental

## Post-Pipeline

When the pipeline completes (done=true or max passes reached):
- All changes will be **automatically committed and pushed** by the extension
- The commit message summarizes all passes performed
- Make sure everything is in a clean, working state before the final `refactor_pass` call

## Skill Self-Improvement

**Every time this skill is used, you MUST evaluate whether the skill files need updating.**

After completing a refactor pipeline, examine what happened — mistakes, gaps, new patterns, or non-obvious lessons — and improve the skill:

**Where to put findings — you decide:**

1. **Existing section fits?** → Add to the most relevant section in `SKILL.md` (Pass Structure, When to Stop, Principles, etc.)
2. **New concept that deserves its own rule?** → Create a `rules/` directory and a `rules/<rule-name>.md` with imperative title, explanation, then `## Avoid` / `## Prefer` examples. Add it to a new Reference Files section in `SKILL.md`
3. **New reference material (refactoring patterns, checklists)?** → Create a `references/` directory and a `references/<name>.md`. Add it to a new Reference Files section in `SKILL.md`
4. **Core workflow change?** → Edit `SKILL.md` directly — update the relevant section or add a new one

**Guidelines:**
- Be concise — one bullet or ⚠️ **Gotcha:** callout per finding
- Don't duplicate — if the lesson is already documented, skip it
- New rule files: imperative title, explain why, then `## Avoid` / `## Prefer` with concrete examples
- After editing, briefly tell the user: *"I've also updated the skill with this finding so future sessions won't hit the same issue."*

---

## Principles

- **Tests must pass** — Every single pass must leave the codebase green. No exceptions.
- **Simplicity over cleverness** — If a junior dev can't read it, simplify it
- **Small passes** — One concern per pass, easy to review and revert
- **Preserve semantics** — Refactoring must not change behavior
- **Explain the why** — Each change should have a clear rationale
