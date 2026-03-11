- [ ] **Register Missing Tools (captain\_define, captain\_generate)** (high priority, small effort)\
  The captain\_define and captain\_generate tools are implemented but not registered in the main extension file. Users can't access these critical pipeline creation features through the tool interface, only slash commands.
- [ ] **Pipeline Validation Tool** (high priority, medium effort)\
  No pre-flight validation exists to catch malformed pipeline specs before execution. Users hit errors during runtime instead of getting early feedback. Mentioned in TODO.md as captain\_validate.
- [ ] **Parallel worktree cleanup can leave git state dirty** (critical priority, small effort)\
  In executePool/executeParallel, worktrees are cleaned up in parallel with Promise.all(). If one worktree removal fails, it doesn't prevent others from completing, but git errors during branch deletion or worktree removal can leave stale references. The error handling in removeWorktree only warns but doesn't ensure git state consistency.
- [ ] **Worktree path collisions across concurrent pipelines** (high priority, medium effort)\
  Multiple pipelines with the same name running simultaneously can create worktree path collisions. The sanitized path only includes pipelineName-branchLabel-index, with no process ID or timestamp. This can cause 'git worktree add' failures or cleanup of active worktrees by other processes.
- [ ] **Required transform field creates boilerplate** (high priority, small effort)\
  Every Step requires a 'transform' field even when users just want to pass output through. This forces `import { full } from "<captain>/transforms/presets.js"` and `transform: full` on every step. Should default to full transform to reduce boilerplate.
- [ ] **Confusing / alias import paths** (high priority, medium effort)\
  The `<captain>/gates/on-fail.js` import syntax is non-standard and breaks IDE autocomplete/IntelliSense. Users must know the exact paths by memory. Consider providing a standard npm-style import or better IDE integration. The string replacement mechanism in state.ts is clever but invisible to TypeScript.
- [ ] **onFail field required despite gates being optional** (medium priority, small effort)\
  Steps require an onFail handler even when there's no gate defined. This forces users to import and specify `skip` or `warn` unnecessarily. Should default to a sensible fallback when gate is undefined.
- [ ] **Split monolithic executor.ts into focused modules** (high priority, large effort)\
  executor.ts is 1102 lines with multiple responsibilities. Split into: session-manager.ts (session creation/warming), model-resolver.ts (model resolution logic), step-runner.ts (core step execution), and composition-executor.ts (sequential/parallel/pool logic). This would improve testability and reduce cognitive load.
- [ ] **Extract common execution patterns for runnable types** (high priority, medium effort)\
  executeSequential, executePool, and executeParallel share identical patterns for gate checking, error handling, and transform application. Create an abstract RunnableExecutor base class or shared execution helpers to eliminate \~100 lines of duplication.
