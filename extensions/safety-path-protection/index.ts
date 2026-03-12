/**
 * Safety Guard: Path Protection
 *
 * Protects sensitive directories and files from unauthorized access:
 *
 * Hard-blocked (read & write):
 *   - .git/ internals — prevents repository corruption
 *
 * Hard-blocked (write only, read allowed):
 *   - node_modules/ — use package manager instead
 *   - .env, .env.local, .env.production, .env.* — secrets files
 *
 * Confirmation required (write):
 *   - Lock files (package-lock.json, yarn.lock, pnpm-lock.yaml, bun.lock)
 *   - CI/CD configs (.github/workflows/, .gitlab-ci.yml)
 *   - Docker configs (Dockerfile, docker-compose.yml)
 *
 * Applies to: read, write, edit tools AND bash commands that reference these paths.
 * The bash check uses regex extraction — not a full parser — so it may over-match,
 * which is the safe default.
 */

import { basename, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";

// ── Path classification ──────────────────────────────────────────────────────

type PathAction = "block" | "confirm" | "allow";

// Patterns for directory-based protection
const GIT_DIR = /(?:^|[/\\])\.git(?:[/\\]|$)/;
const NODE_MODULES = /(?:^|[/\\])node_modules(?:[/\\]|$)/;

// Sensitive filenames (block writes)
const SENSITIVE_FILES = new Set([
	".env",
	".env.local",
	".env.development",
	".env.production",
	".env.staging",
	".env.test",
]);

// Files requiring confirmation before write
const CONFIRM_WRITE_FILES = new Set([
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"bun.lockb",
	"Gemfile.lock",
	"poetry.lock",
	"Cargo.lock",
	"go.sum",
	"composer.lock",
	"Dockerfile",
	"docker-compose.yml",
	"docker-compose.yaml",
	".gitlab-ci.yml",
]);

// Directory patterns requiring confirmation before write
const CONFIRM_WRITE_DIRS = [
	/(?:^|[/\\])\.github[/\\]workflows[/\\]/,
	/(?:^|[/\\])\.circleci[/\\]/,
];

/** Classify a file path for write operations */
function classifyWritePath(filePath: string): {
	action: PathAction;
	reason: string;
} {
	const resolved = resolve(filePath);
	const name = basename(filePath);

	// .git/ — always block (read and write)
	if (GIT_DIR.test(resolved)) {
		return {
			action: "block",
			reason: ".git/ is protected to prevent repository corruption",
		};
	}

	// node_modules/ — block writes
	if (NODE_MODULES.test(resolved)) {
		return {
			action: "block",
			reason: "node_modules/ is protected — use your package manager",
		};
	}

	// .env files — block writes
	if (SENSITIVE_FILES.has(name)) {
		return {
			action: "block",
			reason: `${name} contains secrets and cannot be modified by the agent`,
		};
	}

	// Lock files and CI configs — confirm
	if (CONFIRM_WRITE_FILES.has(name)) {
		return {
			action: "confirm",
			reason: `${name} is a managed file — confirm before editing`,
		};
	}
	for (const pat of CONFIRM_WRITE_DIRS) {
		if (pat.test(resolved)) {
			return {
				action: "confirm",
				reason: "CI/CD configuration — confirm before editing",
			};
		}
	}

	return { action: "allow", reason: "" };
}

/** Classify a file path for read operations (more permissive) */
function classifyReadPath(filePath: string): {
	action: PathAction;
	reason: string;
} {
	const resolved = resolve(filePath);

	// Only .git/ internals are blocked for reads
	if (GIT_DIR.test(resolved)) {
		return {
			action: "block",
			reason: ".git/ is protected to prevent repository corruption",
		};
	}

	return { action: "allow", reason: "" };
}

// ── Bash command path extraction ─────────────────────────────────────────────

// Regex to find .git/ and node_modules/ references in bash commands
const GIT_REF_RE = /(^|[^A-Za-z0-9._-])(\.git(?:[/\\][^\s]*)?)(\s|$|[;&|<>])/g;
const NODE_MODULES_REF_RE =
	/(^|[^A-Za-z0-9._-])(node_modules(?:[/\\][^\s]*)?)(\s|$|[;&|<>])/g;
const ENV_REF_RE = /(?:^|\s)(\.env(?:\.\w+)?)(?:\s|$|[;&|<>])/g;

/** Extract potentially protected path references from a bash command */
function extractProtectedRefs(command: string): string[] {
	const refs = new Set<string>();

	for (const match of command.matchAll(GIT_REF_RE)) {
		if (match[2]) refs.add(match[2]);
	}
	for (const match of command.matchAll(NODE_MODULES_REF_RE)) {
		if (match[2]) refs.add(match[2]);
	}
	for (const match of command.matchAll(ENV_REF_RE)) {
		if (match[1]) refs.add(match[1]);
	}

	return [...refs];
}

// Read-only bash commands that shouldn't trigger write protection
const READ_ONLY_COMMANDS =
	/^\s*(cat|less|more|head|tail|grep|rg|ag|find|ls|tree|file|stat|wc|diff)\b/;

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// --- File tool protection (read, write, edit) ---
	pi.on("tool_call", async (event, ctx) => {
		const isRead = isToolCallEventType("read", event);
		const isWrite =
			isToolCallEventType("write", event) || isToolCallEventType("edit", event);
		if (!(isRead || isWrite)) return undefined;

		const filePath = String(event.input.path ?? event.input.file_path ?? "");
		if (!filePath) return undefined;

		// Read vs write classification
		const { action, reason } = isWrite
			? classifyWritePath(filePath)
			: classifyReadPath(filePath);

		if (action === "block") {
			if (ctx.hasUI) ctx.ui.notify(`🔒 Blocked: ${reason}`, "warning");
			return { block: true, reason };
		}

		if (action === "confirm") {
			if (!ctx.hasUI)
				return { block: true, reason: `${reason} (non-interactive)` };
			const ok = await ctx.ui.confirm(
				"🔒 Protected file",
				`${filePath}\n\n${reason}\n\nAllow?`,
			);
			return ok
				? undefined
				: { block: true, reason: `${reason} — blocked by user` };
		}

		return undefined;
	});

	// --- Bash command path protection ---
	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return undefined;

		const command = event.input.command;
		const refs = extractProtectedRefs(command);
		if (refs.length === 0) return undefined;

		// For read-only commands, only block .git/ access
		const isReadOnly = READ_ONLY_COMMANDS.test(command);

		for (const ref of refs) {
			const { action, reason } = isReadOnly
				? classifyReadPath(ref)
				: classifyWritePath(ref);

			if (action === "block") {
				if (ctx.hasUI)
					ctx.ui.notify(`🔒 Blocked bash access: ${ref}`, "warning");
				return { block: true, reason: `Command references ${ref}: ${reason}` };
			}

			if (action === "confirm") {
				if (!ctx.hasUI)
					return { block: true, reason: `${reason} (non-interactive)` };
				const displayCmd =
					command.length > 100 ? `${command.slice(0, 100)}…` : command;
				const ok = await ctx.ui.confirm(
					"🔒 Protected path in command",
					`${displayCmd}\n\nReferences: ${ref}\n${reason}\n\nAllow?`,
				);
				return ok
					? undefined
					: { block: true, reason: `${reason} — blocked by user` };
			}
		}

		return undefined;
	});

	// Show active status on session start
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(
				"safety-paths",
				ctx.ui.theme.fg("success", "🔒 path-guard"),
			);
		}
	});
}
