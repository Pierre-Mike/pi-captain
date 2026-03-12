// Re-export from infra — kept for backwards compatibility.
// New code should import directly from "./infra/worktree.js".
export { createWorktree, isGitRepo, removeWorktree } from "./infra/worktree.js";
