// ── Gate Evaluation Logic ──────────────────────────────────────────────────

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { ModelRegistryLike } from "./executor.js";
import type { Gate } from "./types.js";

interface GateContext {
	exec: (
		cmd: string,
		args: string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
	confirm?: (title: string, body: string) => Promise<boolean>;
	hasUI: boolean;
	cwd: string;
	signal?: AbortSignal;
	// LLM gate support — optional since non-LLM gates don't need these
	model?: Model<Api>;
	apiKey?: string;
	modelRegistry?: ModelRegistryLike;
}

export interface GateResult {
	passed: boolean;
	reason: string;
}

// ── Individual Gate Handlers ──────────────────────────────────────────────

async function evalCommandGate(
	gate: Extract<Gate, { type: "command" }>,
	gctx: GateContext,
): Promise<GateResult> {
	try {
		const { code, stdout, stderr } = await gctx.exec(
			"bash",
			["-c", gate.value],
			{ signal: gctx.signal },
		);
		return code === 0
			? {
					passed: true,
					reason: `Command passed: ${stdout.trim().slice(0, 200)}`,
				}
			: {
					passed: false,
					reason: `Command failed (exit ${code}): ${(stderr || stdout).trim().slice(0, 200)}`,
				};
	} catch (err) {
		return {
			passed: false,
			reason: `Command error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

async function evalUserGate(
	output: string,
	gctx: GateContext,
): Promise<GateResult> {
	if (!(gctx.hasUI && gctx.confirm)) {
		return { passed: false, reason: "User gate requires interactive UI" };
	}
	const approved = await gctx.confirm(
		"🚦 Step Gate — Approve?",
		output.slice(0, 500) + (output.length > 500 ? "\n…(truncated)" : ""),
	);
	return approved
		? { passed: true, reason: "User approved" }
		: { passed: false, reason: "User rejected" };
}

async function evalPathGate(
	flag: "-f" | "-d",
	value: string,
	label: string,
	gctx: GateContext,
): Promise<GateResult> {
	try {
		const { code } = await gctx.exec("test", [flag, value], {
			signal: gctx.signal,
		});
		return code === 0
			? { passed: true, reason: `${label} exists: ${value}` }
			: { passed: false, reason: `${label} not found: ${value}` };
	} catch {
		return { passed: false, reason: `${label} check error: ${value}` };
	}
}

function evalAssertGate(
	gate: Extract<Gate, { type: "assert" }>,
	output: string,
): GateResult {
	try {
		const result = evaluateAssert(gate.fn, output);
		return result
			? { passed: true, reason: "Assertion passed" }
			: { passed: false, reason: `Assertion failed: ${gate.fn}` };
	} catch (err) {
		return {
			passed: false,
			reason: `Assertion error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

function evalRegexGate(
	gate: Extract<Gate, { type: "regex" }>,
	output: string,
): GateResult {
	try {
		const re = new RegExp(gate.pattern, gate.flags ?? "");
		const matched = re.test(output);
		const desc = `/${gate.pattern}/${gate.flags ?? ""}`;
		return matched
			? { passed: true, reason: `Regex matched: ${desc}` }
			: { passed: false, reason: `Regex did not match: ${desc}` };
	} catch (err) {
		return {
			passed: false,
			reason: `Invalid regex: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

function evalJsonGate(
	gate: Extract<Gate, { type: "json" }>,
	output: string,
): GateResult {
	try {
		const parsed = JSON.parse(output) as Record<string, unknown>;
		if (gate.schema) {
			const requiredKeys = gate.schema.split(",").map((k) => k.trim());
			const missing = requiredKeys.filter((k) => !(k in parsed));
			if (missing.length > 0) {
				return {
					passed: false,
					reason: `JSON missing keys: ${missing.join(", ")}`,
				};
			}
		}
		return {
			passed: true,
			reason: `Valid JSON${gate.schema ? ` with keys: ${gate.schema}` : ""}`,
		};
	} catch {
		return { passed: false, reason: "Output is not valid JSON" };
	}
}

async function evalHttpGate(
	gate: Extract<Gate, { type: "http" }>,
	gctx: GateContext,
): Promise<GateResult> {
	const method = gate.method ?? "GET";
	const expected = gate.expectedStatus ?? 200;
	try {
		const curlCmd = `curl -sf -o /dev/null -w "%{http_code}" -X ${method} "${gate.url}"`;
		const { stdout } = await gctx.exec("bash", ["-c", curlCmd], {
			signal: gctx.signal,
		});
		const statusCode = parseInt(stdout.trim(), 10);
		return statusCode === expected
			? {
					passed: true,
					reason: `HTTP ${method} ${gate.url} → ${statusCode}`,
				}
			: {
					passed: false,
					reason: `HTTP ${method} ${gate.url} → ${statusCode} (expected ${expected})`,
				};
	} catch (err) {
		return {
			passed: false,
			reason: `HTTP check failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

async function evalMultiGate(
	gate: Extract<Gate, { type: "multi" }>,
	output: string,
	gctx: GateContext,
): Promise<GateResult> {
	const results: GateResult[] = [];
	for (const subGate of gate.gates) {
		results.push(await evaluateGate(subGate, output, gctx));
	}

	if (gate.mode === "all") {
		const failed = results.filter((r) => !r.passed);
		return failed.length === 0
			? { passed: true, reason: `All ${results.length} gates passed` }
			: {
					passed: false,
					reason: `${failed.length}/${results.length} gates failed: ${failed.map((f) => f.reason).join("; ")}`,
				};
	}
	const passed = results.filter((r) => r.passed);
	return passed.length > 0
		? {
				passed: true,
				reason: `${passed.length}/${results.length} gates passed (any mode)`,
			}
		: {
				passed: false,
				reason: `All ${results.length} gates failed: ${results.map((r) => r.reason).join("; ")}`,
			};
}

async function evalEnvGate(
	gate: Extract<Gate, { type: "env" }>,
	gctx: GateContext,
): Promise<GateResult> {
	try {
		const cmd = gate.value
			? `test "$${gate.name}" = "${gate.value}"`
			: `test -n "$${gate.name}"`;
		const { code } = await gctx.exec("bash", ["-c", cmd], {
			signal: gctx.signal,
		});
		return code === 0
			? {
					passed: true,
					reason: `Env ${gate.name} is set${gate.value ? ` = ${gate.value}` : ""}`,
				}
			: { passed: false, reason: `Env ${gate.name} not set or mismatch` };
	} catch {
		return { passed: false, reason: `Env check error: ${gate.name}` };
	}
}

async function evalTimeoutGate(
	gate: Extract<Gate, { type: "timeout" }>,
	output: string,
	gctx: GateContext,
): Promise<GateResult> {
	const inner = evaluateGate(gate.gate, output, gctx);
	const timer = new Promise<GateResult>((resolve) =>
		setTimeout(
			() =>
				resolve({
					passed: false,
					reason: `Gate timed out after ${gate.ms}ms`,
				}),
			gate.ms,
		),
	);
	return Promise.race([inner, timer]);
}

async function evalLlmGate(
	gate: Extract<Gate, { type: "llm" }>,
	output: string,
	gctx: GateContext,
): Promise<GateResult> {
	if (!(gctx.model && gctx.apiKey)) {
		return {
			passed: false,
			reason: "LLM gate requires model and apiKey in context",
		};
	}

	const model = gate.model
		? (resolveGateModel(gate.model, gctx) ?? gctx.model)
		: gctx.model;
	const evalPrompt = buildLlmGatePrompt(gate.prompt, output);

	try {
		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: evalPrompt }],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: gctx.apiKey,
				maxTokens: 512,
				signal: gctx.signal,
			},
		);

		const responseText = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		const judgment = parseLlmJudgment(responseText);
		const threshold = gate.threshold ?? 0.7;

		return judgment.pass && judgment.confidence >= threshold
			? {
					passed: true,
					reason: `LLM approved (confidence: ${judgment.confidence.toFixed(2)}): ${judgment.reason}`,
				}
			: {
					passed: false,
					reason: `LLM rejected (confidence: ${judgment.confidence.toFixed(2)}, threshold: ${threshold}): ${judgment.reason}`,
				};
	} catch (err) {
		return {
			passed: false,
			reason: `LLM gate error: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}

// ── Main Gate Dispatcher ─────────────────────────────────────────────────

/** Evaluate a gate against step output. Returns pass/fail with reason. */
export async function evaluateGate(
	gate: Gate,
	output: string,
	gctx: GateContext,
): Promise<GateResult> {
	switch (gate.type) {
		case "none":
			return { passed: true, reason: "No gate configured" };
		case "command":
			return evalCommandGate(gate, gctx);
		case "user":
			return evalUserGate(output, gctx);
		case "file":
			return evalPathGate("-f", gate.value, "File", gctx);
		case "assert":
			return evalAssertGate(gate, output);
		case "regex":
			return evalRegexGate(gate, output);
		case "json":
			return evalJsonGate(gate, output);
		case "http":
			return evalHttpGate(gate, gctx);
		case "multi":
			return evalMultiGate(gate, output, gctx);
		case "dir":
			return evalPathGate("-d", gate.value, "Directory", gctx);
		case "env":
			return evalEnvGate(gate, gctx);
		case "timeout":
			return evalTimeoutGate(gate, output, gctx);
		case "llm":
			return evalLlmGate(gate, output, gctx);
		default:
			return { passed: false, reason: "Unknown gate type" };
	}
}

/**
 * Safe assertion evaluator — supports only these patterns:
 *   output.includes('text')       → string contains check
 *   output.length > N             → length comparison (>, <, >=, <=, ===, !==)
 *   !output.includes('text')      → negated contains
 *   expr || expr                  → logical OR of supported patterns
 *   expr && expr                  → logical AND of supported patterns
 * No arbitrary code execution (no new Function / eval).
 */
function evaluateAssert(expr: string, output: string): boolean {
	const trimmed = expr.trim();

	// Handle logical OR: split on top-level ||
	if (trimmed.includes("||")) {
		return trimmed.split("||").some((part) => evaluateAssert(part, output));
	}

	// Handle logical AND: split on top-level &&
	if (trimmed.includes("&&")) {
		return trimmed.split("&&").every((part) => evaluateAssert(part, output));
	}

	// Negation: !output.includes(...) or !output.toLowerCase().includes(...)
	const negInclude = trimmed.match(
		/^!output(?:\.toLowerCase\(\))?\.includes\((['"])(.*?)\1\)$/,
	);
	if (negInclude) {
		const needle = negInclude[2] ?? "";
		const haystack = trimmed.includes(".toLowerCase()")
			? output.toLowerCase()
			: output;
		return !haystack.includes(needle);
	}

	// output.includes(...) or output.toLowerCase().includes(...)
	const include = trimmed.match(
		/^output(?:\.toLowerCase\(\))?\.includes\((['"])(.*?)\1\)$/,
	);
	if (include) {
		const needle = include[2] ?? "";
		const haystack = trimmed.includes(".toLowerCase()")
			? output.toLowerCase()
			: output;
		return haystack.includes(needle);
	}

	// output.length <op> N
	const lengthCmp = trimmed.match(
		/^output\.length\s*(>=|<=|>|<|===|!==)\s*(\d+)$/,
	);
	if (lengthCmp) {
		const [, op, numStr] = lengthCmp;
		const n = parseInt(numStr ?? "0", 10);
		switch (op) {
			case ">":
				return output.length > n;
			case "<":
				return output.length < n;
			case ">=":
				return output.length >= n;
			case "<=":
				return output.length <= n;
			case "===":
				return output.length === n;
			case "!==":
				return output.length !== n;
			default:
				return false;
		}
	}

	throw new Error(
		`Unsupported assert expression: "${trimmed}". Supported: output.includes('...'), output.length > N, and ||/&& combinations.`,
	);
}

// ── LLM Gate Helpers ────────────────────────────────────────────────────────

// Max chars of step output to include in the LLM evaluation prompt
const LLM_GATE_MAX_OUTPUT_CHARS = 8000;

/** Build the evaluation prompt that instructs the LLM to return structured JSON judgment */
function buildLlmGatePrompt(criteria: string, output: string): string {
	const truncatedOutput = output.slice(0, LLM_GATE_MAX_OUTPUT_CHARS);
	// Allow $OUTPUT interpolation so users can reference output inline in their criteria
	const interpolated = criteria.replace(/\$OUTPUT/g, truncatedOutput);

	return [
		"You are a quality gate evaluator. Your job is to determine whether the following output meets the given criteria.",
		"",
		"## Criteria",
		interpolated,
		"",
		"## Output to Evaluate",
		truncatedOutput,
		"",
		"## Instructions",
		"Respond with ONLY a JSON object (no markdown fences, no explanation outside the JSON):",
		'{ "pass": true/false, "confidence": 0.0-1.0, "reason": "brief explanation" }',
		"",
		"- pass: whether the output meets the criteria",
		"- confidence: how confident you are (0.0 = no confidence, 1.0 = certain)",
		"- reason: 1-2 sentence explanation of your judgment",
	].join("\n");
}

/** Parsed LLM judgment with pass/fail, confidence score, and reasoning */
interface LlmJudgment {
	pass: boolean;
	confidence: number;
	reason: string;
}

/** Parse the LLM's structured JSON response, with fallback heuristic for malformed output */
function parseLlmJudgment(text: string): LlmJudgment {
	// Strip markdown code fences if present
	const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = (jsonMatch ? (jsonMatch[1] ?? text) : text).trim();

	try {
		const parsed = JSON.parse(raw);
		return {
			pass: Boolean(parsed.pass),
			// Clamp confidence to [0, 1]
			confidence:
				typeof parsed.confidence === "number"
					? Math.max(0, Math.min(1, parsed.confidence))
					: 0.5,
			reason: String(parsed.reason ?? "No reason given"),
		};
	} catch {
		// Fallback heuristic: scan for pass/fail keywords with low confidence
		const lower = text.toLowerCase();
		const pass = lower.includes("pass") && !lower.includes("fail");
		return {
			pass,
			confidence: 0.5,
			reason: `Could not parse structured response. Raw: ${text.slice(0, 200)}`,
		};
	}
}

/**
 * Resolve a model name override for LLM gates.
 * Tries the current provider first, then common fallbacks.
 */
function resolveGateModel(
	modelName: string,
	gctx: GateContext,
): Model<Api> | undefined {
	if (!gctx.modelRegistry) return gctx.model;

	const currentProvider = gctx.model?.provider;
	const providers = [
		currentProvider,
		"anthropic",
		"google",
		"openai",
		"openrouter",
		"deepseek",
	].filter((p): p is string => !!p);

	// Deduplicate while preserving order
	const seen = new Set<string>();
	for (const provider of providers) {
		if (seen.has(provider)) continue;
		seen.add(provider);
		try {
			const found = gctx.modelRegistry.find(provider, modelName);
			if (found) return found;
		} catch {
			// Provider not available, try next
		}
	}

	// Fall back to the context's current model if override can't be resolved
	return gctx.model;
}
