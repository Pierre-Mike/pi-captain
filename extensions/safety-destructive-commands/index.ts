/**
 * Safety Guard: Destructive Commands
 *
 * Intercepts bash tool calls that match dangerous patterns and either:
 * - Hard-blocks truly catastrophic commands (dd to disk, mkfs, fork bombs)
 * - Prompts for confirmation on dangerous-but-legitimate commands (rm, sudo, chmod 777)
 *
 * In non-interactive (headless/RPC) mode, all dangerous commands are blocked outright.
 *
 * Patterns are checked against the full command string. The extension is intentionally
 * conservative: it may over-match (e.g. "rm" in a safe context), but that's preferable
 * to missing a real destructive command.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ── Pattern definitions ──────────────────────────────────────────────────────

interface DangerousPattern {
	pattern: RegExp;
	label: string;
	severity: "critical" | "high"; // critical = hard block, high = confirm
}

// Critical: always blocked — no sane reason for an LLM to run these
const CRITICAL_PATTERNS: DangerousPattern[] = [
	{
		pattern: />\s*\/dev\/sd[a-z]/i,
		label: "Write to raw disk device",
		severity: "critical",
	},
	{ pattern: /\bmkfs\b/i, label: "Format filesystem", severity: "critical" },
	{
		pattern: /\bdd\b.*\bof=\/dev\//i,
		label: "dd to device",
		severity: "critical",
	},
	{
		pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/i,
		label: "Fork bomb",
		severity: "critical",
	},
	{
		pattern: /\brm\s+(-rf?\s+)?\/\s*$/i,
		label: "Delete root filesystem",
		severity: "critical",
	},
	{
		pattern: /\brm\s+(-rf?\s+)?\/\s+/i,
		label: "Delete root filesystem",
		severity: "critical",
	},
	{
		pattern: /\b(shutdown|reboot|halt|poweroff)\b/i,
		label: "System shutdown/reboot",
		severity: "critical",
	},
	{
		pattern: /\biptables\s+-F\b/i,
		label: "Flush firewall rules",
		severity: "critical",
	},
];

// High: require user confirmation
const HIGH_PATTERNS: DangerousPattern[] = [
	{
		pattern: /\brm\s+(-[a-z]*r[a-z]*\s+|--recursive\s+)/i,
		label: "Recursive delete (rm -r)",
		severity: "high",
	},
	{
		pattern: /\brm\s+(-[a-z]*f[a-z]*\s+)/i,
		label: "Force delete (rm -f)",
		severity: "high",
	},
	{
		pattern: /\bsudo\b/i,
		label: "Elevated privileges (sudo)",
		severity: "high",
	},
	{
		pattern: /\b(chmod|chown)\b.*777/i,
		label: "World-writable permissions",
		severity: "high",
	},
	{
		pattern: /\bchmod\s+-R\b/i,
		label: "Recursive permission change",
		severity: "high",
	},
	{
		pattern: /\bchown\s+-R\b/i,
		label: "Recursive ownership change",
		severity: "high",
	},
	{
		pattern: /\bkillall\b/i,
		label: "Kill all processes by name",
		severity: "high",
	},
	{
		pattern: /\bpkill\s+-9\b/i,
		label: "Force kill processes",
		severity: "high",
	},
	{
		pattern: /\bsystemctl\s+(stop|disable|mask)\b/i,
		label: "Stop/disable system service",
		severity: "high",
	},
	{
		pattern: /\blaunchctl\s+(unload|remove)\b/i,
		label: "Remove macOS service",
		severity: "high",
	},
	{
		pattern: /\b(truncate|shred)\b/i,
		label: "Destructive file operation",
		severity: "high",
	},
];

const ALL_PATTERNS = [...CRITICAL_PATTERNS, ...HIGH_PATTERNS];

// Exceptions: rm in /tmp or removing build artifacts is common and safe
const SAFE_EXCEPTIONS = [
	/\brm\s+(-rf?\s+)?(\/tmp\/|\.\/node_modules|\.\/dist|\.\/build|\.\/\.next|\.\/target)/i,
];

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;

		// Skip commands that match known safe patterns
		if (SAFE_EXCEPTIONS.some((p) => p.test(command))) return undefined;

		// Check all dangerous patterns (first match wins)
		for (const { pattern, label, severity } of ALL_PATTERNS) {
			if (!pattern.test(command)) continue;

			// Critical commands are always hard-blocked
			if (severity === "critical") {
				if (ctx.hasUI) ctx.ui.notify(`🚫 Blocked: ${label}`, "error");
				return {
					block: true,
					reason: `CRITICAL: ${label} — command is never allowed`,
				};
			}

			// High-severity: confirm with user, or block if no UI
			if (!ctx.hasUI) {
				return {
					block: true,
					reason: `${label} blocked (non-interactive mode)`,
				};
			}

			// Truncate very long commands for the confirmation dialog
			const displayCmd =
				command.length > 120 ? `${command.slice(0, 120)}…` : command;
			const ok = await ctx.ui.confirm(
				`⚠️ ${label}`,
				`${displayCmd}\n\nAllow this command?`,
			);

			return ok
				? undefined
				: { block: true, reason: `${label} — blocked by user` };
		}

		return undefined;
	});

	// Show active status on session start
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(
				"safety-cmds",
				ctx.ui.theme.fg("success", "🛡️ cmd-guard"),
			);
		}
	});
}
