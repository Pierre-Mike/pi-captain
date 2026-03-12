/**
 * Safety Guard: Git & SCM Operations
 *
 * Guards all state-changing git operations and GitHub/GitLab CLI commands.
 * Operations are classified by risk severity:
 *
 * 🔴 Critical (always confirm, auto-deny after 30s):
 *   - git push --force / --force-with-lease
 *   - git reset --hard
 *   - git clean -f
 *   - git stash drop / clear
 *   - git branch -D (force delete)
 *   - git reflog expire
 *
 * 🟡 Standard (confirm with session-remember option):
 *   - git push, commit, rebase, merge, tag, cherry-pick, revert
 *   - gh/glab: PR create/merge/close, issue create/close/delete, release, secrets
 *
 * Features:
 *   - Per-action session memory: approve/block an action type for the whole session
 *   - /git-safety command to view status and reset session approvals
 *   - In non-interactive mode, all operations are blocked
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ── Pattern definitions ──────────────────────────────────────────────────────

type Severity = "critical" | "standard";

interface GitPattern {
	pattern: RegExp;
	action: string; // Human-readable action name (used as session memory key)
	severity: Severity;
}

const GIT_PATTERNS: GitPattern[] = [
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

// ── Session memory ───────────────────────────────────────────────────────────

// Track which actions the user has pre-approved or pre-blocked for this session
const sessionApproved = new Set<string>();
const sessionBlocked = new Set<string>();

function resetSessionMemory() {
	sessionApproved.clear();
	sessionBlocked.clear();
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Reset session memory on new/switched sessions
	pi.on("session_start", async (_event, ctx) => {
		resetSessionMemory();
		if (ctx.hasUI) {
			ctx.ui.setStatus(
				"safety-git",
				ctx.ui.theme.fg("success", "🔀 git-guard"),
			);
		}
	});
	pi.on("session_switch", async () => resetSessionMemory());

	// /git-safety command: view status and manage session approvals
	pi.registerCommand("git-safety", {
		description: "View git safety status and reset session approvals",
		handler: async (_args, ctx) => {
			const lines = ["─── Git Safety Status ───", ""];

			if (sessionApproved.size > 0) {
				lines.push("✅ Auto-approved for this session:");
				for (const action of sessionApproved) lines.push(`   • ${action}`);
				lines.push("");
			}

			if (sessionBlocked.size > 0) {
				lines.push("🚫 Auto-blocked for this session:");
				for (const action of sessionBlocked) lines.push(`   • ${action}`);
				lines.push("");
			}

			if (sessionApproved.size === 0 && sessionBlocked.size === 0) {
				lines.push(
					"No session overrides active — all operations prompt normally.",
				);
				lines.push("");
			}

			lines.push("Use /git-safety reset to clear all session overrides.");
			lines.push("───────────────────────");

			ctx.ui.notify(lines.join("\n"), "info");

			// Handle "reset" argument
			if (_args.trim().toLowerCase() === "reset") {
				resetSessionMemory();
				ctx.ui.notify("✅ Session git approvals/blocks cleared.", "success");
			}
		},
	});

	// Intercept bash tool calls for git/gh/glab commands
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;

		// Find first matching pattern (patterns are ordered critical-first)
		for (const { pattern, action, severity } of GIT_PATTERNS) {
			if (!pattern.test(command)) continue;

			// Check session memory first
			if (sessionBlocked.has(action)) {
				if (ctx.hasUI)
					ctx.ui.notify(`🚫 ${action} — auto-blocked (session)`, "warning");
				return { block: true, reason: `${action} blocked (session setting)` };
			}
			if (sessionApproved.has(action)) {
				return undefined; // silently approved
			}

			// No UI? Block everything
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: `${action} requires confirmation (no UI)`,
				};
			}

			// Build confirmation dialog
			const icon = severity === "critical" ? "🔴" : "🟡";
			const displayCmd =
				command.length > 120 ? `${command.slice(0, 120)}…` : command;

			if (severity === "critical") {
				// Critical: simple confirm with auto-deny timeout (30s)
				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), 30_000);

				const choice = await ctx.ui.select(
					`${icon} CRITICAL: ${action}\n\n  ${displayCmd}\n\nAllow? (auto-deny in 30s)`,
					["✅ Allow once", "🚫 Block"],
					{ signal: controller.signal },
				);

				clearTimeout(timeout);

				if (controller.signal.aborted || choice !== "✅ Allow once") {
					const reason = controller.signal.aborted
						? "Timed out (30s)"
						: "Blocked by user";
					return { block: true, reason: `${action}: ${reason}` };
				}
				return undefined;
			}

			// Standard: offer session-remember options
			const choice = await ctx.ui.select(
				`${icon} ${action}\n\n  ${displayCmd}\n\nAllow?`,
				[
					"✅ Allow once",
					"🚫 Block once",
					`✅✅ Auto-approve "${action}" for this session`,
					`🚫🚫 Auto-block "${action}" for this session`,
				],
			);

			if (!choice || choice.startsWith("🚫🚫")) {
				sessionBlocked.add(action);
				ctx.ui.notify(
					`🚫 All "${action}" commands auto-blocked for this session`,
					"warning",
				);
				return { block: true, reason: `${action} blocked by user (session)` };
			}

			if (choice.startsWith("🚫")) {
				return { block: true, reason: `${action} blocked by user` };
			}

			if (choice.startsWith("✅✅")) {
				sessionApproved.add(action);
				ctx.ui.notify(
					`✅ All "${action}" commands auto-approved for this session`,
					"info",
				);
			}

			return undefined;
		}

		return undefined;
	});
}
