/**
 * Git Safety Patterns and Session Management
 *
 * Pattern definitions for git, gh, and glab commands with severity classification.
 * Session memory for tracking per-action user preferences.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = "critical" | "standard";

export interface GitPattern {
	pattern: RegExp;
	action: string; // Human-readable action name (used as session memory key)
	severity: Severity;
}

// ── Pattern definitions ──────────────────────────────────────────────────────

export const GIT_PATTERNS: GitPattern[] = [
	// Critical — destructive, hard to undo
	{
		pattern: /\bgit\s+push\s+.*--force(-with-lease)?\b/i,
		action: "force push",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+push\s+-f\b/i,
		action: "force push",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+reset\s+--hard\b/i,
		action: "hard reset",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+clean\s+-[a-z]*f/i,
		action: "clean (remove untracked)",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+stash\s+(drop|clear)\b/i,
		action: "drop/clear stash",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+branch\s+-D\b/i,
		action: "force-delete branch",
		severity: "critical",
	},
	{
		pattern: /\bgit\s+reflog\s+expire\b/i,
		action: "expire reflog",
		severity: "critical",
	},

	// Standard — state-changing but recoverable
	{ pattern: /\bgit\s+push\b/i, action: "push", severity: "standard" },
	{ pattern: /\bgit\s+commit\b/i, action: "commit", severity: "standard" },
	{ pattern: /\bgit\s+rebase\b/i, action: "rebase", severity: "standard" },
	{ pattern: /\bgit\s+merge\b/i, action: "merge", severity: "standard" },
	{
		pattern: /\bgit\s+tag\b/i,
		action: "create/modify tag",
		severity: "standard",
	},
	{
		pattern: /\bgit\s+cherry-pick\b/i,
		action: "cherry-pick",
		severity: "standard",
	},
	{ pattern: /\bgit\s+revert\b/i, action: "revert", severity: "standard" },
	{ pattern: /\bgit\s+am\b/i, action: "apply patches", severity: "standard" },
	{
		pattern: /\bgit\s+branch\s+-d\b/i,
		action: "delete branch",
		severity: "standard",
	},

	// GitHub CLI — external side effects
	{
		pattern: /\bgh\s+pr\s+create\b/i,
		action: "create GitHub PR",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+pr\s+merge\b/i,
		action: "merge GitHub PR",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+pr\s+close\b/i,
		action: "close GitHub PR",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+pr\s+(comment|review)\b/i,
		action: "comment/review GitHub PR",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+issue\s+create\b/i,
		action: "create GitHub issue",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+issue\s+(close|delete)\b/i,
		action: "close/delete GitHub issue",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+release\s+(create|delete|edit)\b/i,
		action: "manage GitHub release",
		severity: "standard",
	},
	{
		pattern: /\bgh\s+repo\s+(create|delete|rename|archive)\b/i,
		action: "manage GitHub repo",
		severity: "critical",
	},
	{
		pattern: /\bgh\s+secret\s+(set|delete|remove)\b/i,
		action: "manage GitHub secrets",
		severity: "critical",
	},

	// GitLab CLI
	{
		pattern: /\bglab\s+mr\s+create\b/i,
		action: "create GitLab MR",
		severity: "standard",
	},
	{
		pattern: /\bglab\s+mr\s+(merge|close)\b/i,
		action: "merge/close GitLab MR",
		severity: "standard",
	},
	{
		pattern: /\bglab\s+issue\s+(create|close|delete)\b/i,
		action: "manage GitLab issue",
		severity: "standard",
	},
	{
		pattern: /\bglab\s+release\s+(create|delete)\b/i,
		action: "manage GitLab release",
		severity: "standard",
	},
	{
		pattern: /\bglab\s+repo\s+(create|delete|archive)\b/i,
		action: "manage GitLab repo",
		severity: "critical",
	},
];

// ── Hard-blocked patterns (never allowed, no confirmation) ──────────────────

/**
 * These patterns are ALWAYS blocked — no confirmation dialog, no session override.
 * The user's intent is absolute: these flags must never be executed.
 */
export interface HardBlockedPattern {
	pattern: RegExp;
	action: string;
	reason: string;
}

export const ALWAYS_BLOCKED_PATTERNS: HardBlockedPattern[] = [
	{
		pattern: /--no-verify\b/i,
		action: "--no-verify",
		reason:
			"--no-verify bypasses git hooks (pre-commit, commit-msg, pre-push). This flag is permanently blocked.",
	},
];

// ── Session memory ───────────────────────────────────────────────────────────

// Track which actions the user has pre-approved or pre-blocked for this session
export const sessionApproved = new Set<string>();
export const sessionBlocked = new Set<string>();

export function resetSessionMemory() {
	sessionApproved.clear();
	sessionBlocked.clear();
}
