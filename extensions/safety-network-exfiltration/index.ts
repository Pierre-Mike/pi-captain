/**
 * Safety Guard: Network & Exfiltration Prevention
 *
 * Prevents data exfiltration and dangerous network operations:
 *
 * 🔴 Hard-blocked:
 *   - Piped shell execution: curl/wget | sh/bash/zsh (remote code execution)
 *   - Commands that embed secrets: tokens, passwords, API keys in curl/wget/fetch
 *   - Outbound transfer of sensitive files (.env, id_rsa, private keys)
 *
 * 🟡 Confirmation required:
 *   - curl/wget POST/PUT/PATCH/DELETE requests (data upload)
 *   - scp/rsync to remote hosts (file transfer)
 *   - nc/netcat/ncat commands (raw network access)
 *   - npm/pip/gem publish (package publishing)
 *
 * This is intentionally paranoid — LLMs should not be silently uploading data
 * or executing remote scripts without explicit human approval.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ── Detection patterns ───────────────────────────────────────────────────────

// Piped remote code execution (critical — always block)
const PIPED_SHELL_PATTERNS = [
	/\bcurl\b[^|]*\|\s*(sh|bash|zsh|dash|ksh|fish)\b/i,
	/\bwget\b[^|]*\|\s*(sh|bash|zsh|dash|ksh|fish)\b/i,
	/\bcurl\b[^|]*\|\s*sudo\s+(sh|bash|zsh)\b/i,
	/\bwget\b[^|]*\|\s*sudo\s+(sh|bash|zsh)\b/i,
	// Reverse: bash <(curl ...) or bash -c "$(curl ...)"
	/\b(sh|bash|zsh)\s+<\(\s*(curl|wget)\b/i,
	/\b(sh|bash|zsh)\s+-c\s+.*\$\(\s*(curl|wget)\b/i,
];

// Secret patterns — tokens/keys/passwords embedded in commands (critical)
const SECRET_PATTERNS = [
	// API keys and tokens in headers or URLs
	/\b(curl|wget|fetch|http)\b.*(-H|--header)\s+['"]?Authorization:\s*(Bearer|Basic|Token)\s+[A-Za-z0-9_\-./+=]{20,}/i,
	// Common secret variable names passed as data
	/\b(curl|wget)\b.*(-d|--data|--data-raw)\s+.*\b(password|secret|token|api[_-]?key|private[_-]?key)\s*[=:]/i,
	// Uploading well-known secret files
	/\b(curl|wget|scp|rsync)\b.*\.(env|pem|key|p12|pfx|jks|keystore)\b/i,
	/\b(curl|wget|scp|rsync)\b.*\bid_rsa\b/i,
	/\b(curl|wget|scp|rsync)\b.*\.ssh[/\\]/i,
	// Inline tokens that look like real secrets (long hex/base64)
	/\b(curl|wget)\b.*[?&](token|key|secret|apikey)=[A-Za-z0-9_\-./+=]{20,}/i,
];

// Outbound data upload (confirmation required)
const UPLOAD_PATTERNS = [
	// curl/wget with mutation methods
	{
		pattern:
			/\bcurl\b.*(-X\s*(POST|PUT|PATCH|DELETE)|--request\s*(POST|PUT|PATCH|DELETE))/i,
		label: "curl POST/PUT/PATCH/DELETE",
	},
	{
		pattern:
			/\bcurl\b.*(-d\s|--data\s|--data-raw\s|--data-binary\s|-F\s|--form\s)/i,
		label: "curl data upload",
	},
	// wget POST
	{ pattern: /\bwget\b.*--post-(data|file)\b/i, label: "wget POST" },
	// File transfer tools
	{ pattern: /\bscp\b.*\S+@\S+:/i, label: "scp to remote host" },
	{ pattern: /\brsync\b.*\S+@\S+:/i, label: "rsync to remote host" },
	// Raw network access
	{ pattern: /\b(nc|netcat|ncat)\b/i, label: "netcat (raw network)" },
	// Package publishing (irreversible external action)
	{ pattern: /\bnpm\s+publish\b/i, label: "npm publish" },
	{ pattern: /\bpip\s+upload\b/i, label: "pip upload" },
	{ pattern: /\bgem\s+push\b/i, label: "gem push" },
	{ pattern: /\bcargo\s+publish\b/i, label: "cargo publish" },
	// Docker push
	{ pattern: /\bdocker\s+push\b/i, label: "docker push" },
	// SSH commands (potential tunnel/exfil)
	{ pattern: /\bssh\b.*-[LRD]\b/i, label: "SSH tunnel" },
];

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Legacy handler will be refactored
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;

		// 1. Piped remote code execution — always block
		for (const pattern of PIPED_SHELL_PATTERNS) {
			if (pattern.test(command)) {
				if (ctx.hasUI)
					ctx.ui.notify("🚫 Blocked: piped remote code execution", "error");
				return {
					block: true,
					reason:
						"Remote code execution via piped shell is never allowed. Download the script first, review it, then run it.",
				};
			}
		}

		// 2. Secrets in commands — always block
		for (const pattern of SECRET_PATTERNS) {
			if (pattern.test(command)) {
				if (ctx.hasUI)
					ctx.ui.notify(
						"🚫 Blocked: command contains embedded secrets",
						"error",
					);
				return {
					block: true,
					reason:
						"Command appears to contain embedded secrets (tokens, keys, passwords). Use environment variables or config files instead.",
				};
			}
		}

		// 3. Data upload / network transfer — require confirmation
		for (const { pattern, label } of UPLOAD_PATTERNS) {
			if (pattern.test(command)) {
				if (!ctx.hasUI) {
					return {
						block: true,
						reason: `${label} blocked (non-interactive mode)`,
					};
				}

				const displayCmd =
					command.length > 120 ? `${command.slice(0, 120)}…` : command;
				const ok = await ctx.ui.confirm(
					`🌐 Network: ${label}`,
					`${displayCmd}\n\nThis command sends data over the network. Allow?`,
				);

				return ok
					? undefined
					: { block: true, reason: `${label} — blocked by user` };
			}
		}

		return undefined;
	});

	// Also check write tool for secret content being written to files
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("write", event)) return undefined;

		const content = String(event.input.content ?? "");
		const filePath = String(event.input.path ?? "");

		// Check if writing content that looks like it's exfiltrating secrets
		// (e.g., writing a script that curls secrets somewhere)
		for (const pattern of PIPED_SHELL_PATTERNS) {
			if (pattern.test(content)) {
				if (ctx.hasUI)
					ctx.ui.notify(
						"🚫 Blocked: file contains piped remote execution",
						"error",
					);
				return {
					block: true,
					reason: `Writing to ${filePath}: content contains piped remote code execution pattern`,
				};
			}
		}

		return undefined;
	});

	// Show active status on session start
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(
				"safety-net",
				ctx.ui.theme.fg("success", "🌐 net-guard"),
			);
		}
	});
}
