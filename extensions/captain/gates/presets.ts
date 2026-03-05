// ── Gate Presets — reusable, parameterized gate factories ─────────────────
// Each function returns a Gate object. Use like: command("bun test")
import type { Gate } from "../types.js";

// ── Atomic Gates ──────────────────────────────────────────────────────────

/** No validation — always passes */
export const none: Gate = { type: "none" };

/** Human approval gate — requires interactive UI */
export const user: Gate = { type: "user", value: true };

/** Run a shell command — exit 0 = pass */
export function command(cmd: string): Gate {
	return { type: "command", value: cmd };
}

/** Check that a file exists (relative to cwd) */
export function file(path: string): Gate {
	return { type: "file", value: path };
}

/** Check that a directory exists (relative to cwd) */
export function dir(path: string): Gate {
	return { type: "dir", value: path };
}

/** Raw assert expression evaluated against `output` string */
export function assert(expr: string): Gate {
	return { type: "assert", fn: expr };
}

// ── Compound Gates (common patterns as one-liners) ────────────────────────

/** Assert the output contains a specific string (case-sensitive) */
export function outputIncludes(needle: string): Gate {
	return {
		type: "assert",
		fn: `output.includes('${needle.replace(/'/g, "\\'")}')`,
	};
}

/** Assert the output contains a string (case-insensitive) */
export function outputIncludesCI(needle: string): Gate {
	return {
		type: "assert",
		fn: `output.toLowerCase().includes('${needle.toLowerCase().replace(/'/g, "\\'")}')`,
	};
}

/** Assert the output is at least N characters long */
export function outputMinLength(n: number): Gate {
	return { type: "assert", fn: `output.length > ${n}` };
}

// ── Regex Gates ───────────────────────────────────────────────────────────

/** Output must match a regex pattern */
export function regex(pattern: string, flags?: string): Gate {
	return { type: "regex", pattern, flags };
}

/** Output must match a regex (case-insensitive) */
export function regexCI(pattern: string): Gate {
	return { type: "regex", pattern, flags: "i" };
}

/** Output must NOT match a regex pattern (wrapped in multi-any-inversion) */
export function regexExcludes(pattern: string, _flags?: string): Gate {
	// Negate: we use a command gate to test the inverse via bash
	return command(
		`echo "${escapeForBash("$OUTPUT")}" | grep -qvP '${pattern}' || exit 1`,
	);
}

// ── JSON Gates ────────────────────────────────────────────────────────────

/** Output must be valid JSON */
export const jsonValid: Gate = { type: "json" };

/** Output must be valid JSON containing specific top-level keys (comma-separated) */
export function jsonHasKeys(...keys: string[]): Gate {
	return { type: "json", schema: keys.join(",") };
}

// ── HTTP Gates ────────────────────────────────────────────────────────────

/** Check that a URL returns HTTP 200 */
export function httpOk(url: string): Gate {
	return { type: "http", url, method: "GET", expectedStatus: 200 };
}

/** Check that a URL returns a specific status code */
export function httpStatus(
	url: string,
	status: number,
	method: string = "GET",
): Gate {
	return { type: "http", url, method, expectedStatus: status };
}

/** POST health check — useful for API readiness gates */
export function httpPostOk(url: string): Gate {
	return { type: "http", url, method: "POST", expectedStatus: 200 };
}

// ── Combinator Gates ──────────────────────────────────────────────────────

/** All sub-gates must pass (logical AND) */
export function allOf(...gates: Gate[]): Gate {
	return { type: "multi", mode: "all", gates };
}

/** At least one sub-gate must pass (logical OR) */
export function anyOf(...gates: Gate[]): Gate {
	return { type: "multi", mode: "any", gates };
}

// ── Environment Gates ─────────────────────────────────────────────────────

/** Check that an environment variable is set (non-empty) */
export function envSet(name: string): Gate {
	return { type: "env", name };
}

/** Check that an environment variable equals a specific value */
export function envEquals(name: string, value: string): Gate {
	return { type: "env", name, value };
}

/** Common env check: NODE_ENV must be "production" */
export const prodEnv = envEquals("NODE_ENV", "production");

// ── Timeout Gate ──────────────────────────────────────────────────────────

/** Wrap any gate with a timeout — fails if the inner gate takes too long */
export function withTimeout(gate: Gate, ms: number): Gate {
	return { type: "timeout", gate, ms };
}

// ── Test Runner Gates ─────────────────────────────────────────────────────

/** Run bun test — exit 0 = pass */
export const bunTest = command("bun test");

/** Run bun typecheck — exit 0 = pass */
export const bunTypecheck = command("bunx tsc --noEmit");

/** Run bun lint — exit 0 = pass */
export const bunLint = command("bun run lint");

// ── Build Artifact Gates ──────────────────────────────────────────────────

/** Check dist/index.js exists (common build output) */
export const distExists = file("dist/index.js");

/** Check a build output file exists */
export function buildOutput(path: string): Gate {
	return file(path);
}

/** Check dist/ directory exists */
export const distDirExists = dir("dist");

/** Check node_modules/ directory exists (deps installed) */
export const nodeModulesExists = dir("node_modules");

// ── Chained Command Gates ─────────────────────────────────────────────────

/** Run multiple commands — all must pass (joined with &&) */
export function commandAll(...cmds: string[]): Gate {
	return { type: "command", value: cmds.join(" && ") };
}

/** Test + typecheck combo — common CI-like gate */
export const testAndTypecheck = commandAll("bun test", "bunx tsc --noEmit");

/** Full CI pipeline: test + typecheck + lint */
export const fullCI = commandAll(
	"bun test",
	"bunx tsc --noEmit",
	"bun run lint",
);

// ── Docker / Service Gates ────────────────────────────────────────────────

/** Check a Docker container is running by name */
export function dockerRunning(containerName: string): Gate {
	return command(
		`docker ps --format '{{.Names}}' | grep -q '^${containerName}$'`,
	);
}

/** Check that a port is listening (service is up) */
export function portListening(port: number, host: string = "localhost"): Gate {
	return command(`nc -z ${host} ${port}`);
}

// ── Git Gates ─────────────────────────────────────────────────────────────

/** Working directory is clean (no uncommitted changes) */
export const gitClean = command('test -z "$(git status --porcelain)"');

/** Current branch matches a name */
export function gitBranch(branch: string): Gate {
	return command(`test "$(git branch --show-current)" = "${branch}"`);
}

/** No merge conflicts present */
export const noConflicts = command(
	"! grep -rn '<<<<<<< ' --include='*.ts' --include='*.js' --include='*.tsx' --include='*.jsx' .",
);

// ── Composite Preset Gates ────────────────────────────────────────────────

/** Production readiness: tests pass + build exists + typecheck passes */
export const prodReady = allOf(bunTest, bunTypecheck, distExists);

/** API readiness: server is up + tests pass */
export function apiReady(healthUrl: string): Gate {
	return allOf(httpOk(healthUrl), bunTest);
}

// ── LLM Evaluation Gates ──────────────────────────────────────────────────

/**
 * LLM-evaluated gate — ask an LLM if the step output meets the given criteria.
 * The prompt supports $OUTPUT interpolation to reference the step output inline.
 * @param prompt  - Evaluation criteria (e.g. "Does this cover all edge cases?")
 * @param opts    - Optional model override and confidence threshold (default 0.7)
 */
export function llm(
	prompt: string,
	opts?: { model?: string; threshold?: number },
): Gate {
	return {
		type: "llm",
		prompt,
		model: opts?.model,
		threshold: opts?.threshold,
	};
}

/** LLM gate using a fast/cheap model (e.g. "flash") for cost-effective evaluation */
export function llmFast(prompt: string, threshold?: number): Gate {
	return { type: "llm", prompt, model: "flash", threshold };
}

/** LLM gate requiring high confidence (0.9 threshold) for strict quality checks */
export function llmStrict(prompt: string, model?: string): Gate {
	return { type: "llm", prompt, model, threshold: 0.9 };
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Escape a string for safe embedding in bash commands */
function escapeForBash(s: string): string {
	return s.replace(/'/g, "'\\''");
}
