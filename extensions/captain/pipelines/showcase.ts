// ── Pipeline: Showcase ───────────────────────────────────────────────────
// A self-contained demo pipeline that exercises every step feature
// using only inline config (no named agents), all on flash.
//
// What it tests:
//   1. BRAINSTORM  — basic step: $INPUT → ideas list
//   2. CHALLENGE   — sequential gate: assert output.includes("1.")
//   3. EXPAND ×2   — parallel: two branches expand different halves
//   4. VOTE        — parallel merge strategy: vote
//   5. SCORE       — pool ×3: three rankers, merge with "rank"
//   6. SUMMARIZE   — transform: "summarize" (LLM compression)
//   7. FORMAT      — transform: "extract" key from JSON output
//   8. RETRY DEMO  — gate: always fails → exhausts retry(2) → step fails
//   9. WARN DEMO   — gate: assert fails → warn (continues anyway)
//  10. FALLBACK    — gate: assert fails → fallback step
//  11. TOOL DEMO   — step with tools: ["bash"] → runs echo + node --version
//  12. LLM FAST    — gate: llmFast() judges output quality via a fast LLM
//  13. FINAL       — sequential wrapping everything with a none gate
//
// Run: captain_run { name: "captain:showcase", input: "list 5 hobbies" }
// Load: captain_load { action: "load", name: "captain:showcase" }

import { llmFast } from "../gates/llm.js";
import { fallback as onFailFallback, retry, warn } from "../gates/on-fail.js";
import { regexCI } from "../gates/presets.js";
import { concat, rank } from "../merge.js";
import { extract, full, summarize } from "../transforms/presets.js";
import type {
	Gate,
	OnFail,
	Parallel,
	Pool,
	Runnable,
	Sequential,
	Step,
} from "../types.js";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const flash = "flash";
const noTools: string[] = [];
const noGate: Gate = () => true;
const noFail: OnFail = warn;

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — Basic step: raw input → numbered list of ideas
// ─────────────────────────────────────────────────────────────────────────

const brainstorm: Step = {
	kind: "step",
	label: "brainstorm",
	model: "sonnet",
	tools: noTools,
	prompt: `You are a creative brainstormer.
Given this topic: "$INPUT"
Output a numbered list of exactly 5 short ideas (one per line).
Format: "1. <idea>"`,
	gate: ({ output }) => output.length > 10 || "not long enough",
	onFail: retry(2),
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 2 — Gate: assert — validates the brainstorm output has "1."
// ─────────────────────────────────────────────────────────────────────────

const challenge: Step = {
	kind: "step",
	label: "challenge",
	model: flash,
	tools: noTools,
	prompt: `Review these ideas and add a one-sentence critique to each.
Keep the original numbering.

Ideas:
$INPUT`,
	gate: ({ output }) =>
		output.includes("1.") ? true : 'Output must include "1."',
	onFail: retry(3),
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Steps 3a & 3b — Parallel branches: each expands a different angle
// ─────────────────────────────────────────────────────────────────────────

const expandPractical: Step = {
	kind: "step",
	label: "expand-practical",
	model: flash,
	tools: noTools,
	prompt: `Focus on the PRACTICAL side of these ideas.
For each idea, add a one-line "How to start" tip.

$INPUT`,
	gate: noGate,
	onFail: noFail,
	transform: full,
};

const expandCreative: Step = {
	kind: "step",
	label: "expand-creative",
	model: flash,
	tools: noTools,
	prompt: `Focus on the CREATIVE side of these ideas.
For each idea, add a one-line "Fun twist" suggestion.

$INPUT`,
	gate: noGate,
	onFail: noFail,
	transform: full,
};

// Parallel with "vote" merge — both branches see the same input
const expandParallel: Parallel = {
	kind: "parallel",
	steps: [expandPractical, expandCreative],
	merge: concat,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 4 — Pool ×3 with "rank" merge: three rankers score the ideas
// ─────────────────────────────────────────────────────────────────────────

const ranker: Step = {
	kind: "step",
	label: "ranker",
	model: flash,
	tools: noTools,
	prompt: `You are a ranking judge. Read the following ideas and pick the TOP 3.
Return ONLY a numbered list of the top 3 with a one-line reason each.

$INPUT`,
	gate: regexCI("^1\\."),
	onFail: warn,
	transform: full,
};

const rankPool: Pool = {
	kind: "pool",
	step: ranker,
	count: 3,
	merge: rank,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 5 — Transform: summarize (LLM compression)
// ─────────────────────────────────────────────────────────────────────────

const summarizeStep: Step = {
	kind: "step",
	label: "summarize",
	model: flash,
	tools: noTools,
	prompt: `Summarize the following ranked ideas into a single paragraph recommendation.

$INPUT`,
	gate: noGate,
	onFail: noFail,
	transform: summarize(),
};

// ─────────────────────────────────────────────────────────────────────────
// Step 6 — Transform: extract — ask for JSON, pull out a key
// ─────────────────────────────────────────────────────────────────────────

const formatStep: Step = {
	kind: "step",
	label: "format-json",
	model: flash,
	tools: noTools,
	prompt: `Based on this summary, output ONLY a JSON object (no markdown, no explanation):
{"winner": "<the single best idea in 5 words or less>", "score": <integer 1-10>}

Summary:
$INPUT`,
	gate: ({ output }) => {
		try {
			JSON.parse(output.trim());
			return true;
		} catch {
			return "Output is not valid JSON";
		}
	},
	// ⚠️  flash sometimes wraps JSON in markdown — this should not happen with a strict prompt
	onFail: warn,
	transform: extract("winner"),
};

// ─────────────────────────────────────────────────────────────────────────
// Step 7 — onFail: warn — gate will fail (output won't be a plain number)
//           but pipeline continues with a ⚠️ warning
// ─────────────────────────────────────────────────────────────────────────

const warnDemo: Step = {
	kind: "step",
	label: "warn-demo",
	model: flash,
	tools: noTools,
	prompt: `Say: "The winner is: $INPUT. Great choice!"`,
	gate: ({ output }) =>
		output.trim() === "42" ? true : "Output must be exactly '42'",
	onFail: warn,
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 8 — onFail: fallback — gate fails, fallback step runs instead
// ─────────────────────────────────────────────────────────────────────────

const fallbackStep: Step = {
	kind: "step",
	label: "fallback-recovery",
	model: flash,
	tools: noTools,
	prompt: `The previous step had an issue. Generate a friendly closing message
that mentions the winner idea: "$INPUT"`,
	gate: noGate,
	onFail: noFail,
	transform: full,
};

const fallbackDemo: Step = {
	kind: "step",
	label: "fallback-demo",
	model: flash,
	tools: noTools,
	prompt: `Output ONLY the word "FAIL" — nothing else.`,
	gate: ({ output }) =>
		output.trim() !== "FAIL" ? true : "Output must not be 'FAIL'",
	onFail: onFailFallback(fallbackStep),
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 9 — Tool demo: uses the bash tool to check node version and echo the winner
// ─────────────────────────────────────────────────────────────────────────

const toolDemo: Step = {
	kind: "step",
	label: "tool-demo",
	model: flash,
	tools: ["bash"],
	prompt: `You have access to the bash tool.
Do the following steps in order:
1. Run: echo "Winner: $INPUT"
2. Run: node --version
Then output a single line: "Tool demo complete. Winner: $INPUT. Node: <version>"`,
	gate: ({ output, ctx }) => {
		if (!output.toLowerCase().includes("tool demo complete"))
			return "Output must contain 'Tool demo complete'";
		if (!ctx?.toolsUsed?.includes("bash"))
			return `'bash' tool was never called — tools used: [${ctx?.toolsUsed?.join(", ") ?? "none"}]`;
		return true;
	},
	onFail: warn,
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 10 — Web search demo: uses the web_search tool to find current info
// ─────────────────────────────────────────────────────────────────────────

const webSearchDemo: Step = {
	kind: "step",
	label: "web-search-demo",
	model: flash,
	tools: ["web_search"],
	prompt: `You have access to the web_search tool.
Search the web for: "best hobbies to start in 2025"
Then output a single line starting with "Web search complete:" followed by the top 3 hobbies you found.`,
	gate: ({ output, ctx }) => {
		if (!output.toLowerCase().includes("web search complete"))
			return "Output must contain 'Web search complete'";
		if (!ctx?.toolsUsed?.includes("web_search"))
			return `'web_search' tool was never called — tools used: [${ctx?.toolsUsed?.join(", ") ?? "none"}]`;
		return true;
	},
	onFail: warn,
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 11 — llmFast gate demo: output is evaluated by a fast LLM judge
// ─────────────────────────────────────────────────────────────────────────

const llmFastDemo: Step = {
	kind: "step",
	label: "llm-fast-gate-demo",
	model: flash,
	tools: noTools,
	prompt: `Write a single enthusiastic sentence congratulating the user on their great hobby idea: "$INPUT".
Keep it positive, specific, and under 20 words.`,
	gate: llmFast(
		"The output is a single enthusiastic congratulatory sentence, under 20 words, and mentions a hobby or idea.",
		0.7,
	),
	onFail: warn,
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Step 12 — Retry demo: gate checks real output — must be exactly "hello"
//           (lowercase, no punctuation, no extra words). The model is
//           tempted to elaborate; the gate catches any deviation and retries.
// ─────────────────────────────────────────────────────────────────────────

const retryDemo: Step = {
	kind: "step",
	label: "retry-demo",
	model: flash,
	tools: noTools,
	prompt: `Reply with the single word: hello
No punctuation, no capitalisation, no extra words.`,
	gate: ({ output }) => `Gate always fails — got: "${output.trim()}"`,
	onFail: retry(3),
	transform: full,
};

// ─────────────────────────────────────────────────────────────────────────
// Final assembly — sequential wrapping all stages
// ─────────────────────────────────────────────────────────────────────────

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		brainstorm, //  1️⃣  basic step
		challenge, //  2️⃣  assert gate + retry onFail
		expandParallel, //  3️⃣  parallel (concat merge)
		rankPool, //  4️⃣  pool ×3 (rank merge) + regex gate
		summarizeStep, //  5️⃣  summarize transform
		formatStep, //  6️⃣  JSON gate + extract transform
		warnDemo, //  7️⃣  warn onFail demo
		fallbackDemo, //  8️⃣  fallback onFail demo
		toolDemo, //  9️⃣  tool usage demo (bash)
		webSearchDemo, // 🔟  web search tool demo
		llmFastDemo, // 1️⃣1️⃣  llmFast gate demo
		retryDemo, // 1️⃣2️⃣  closure-counter retry demo
	],
	gate: noGate,
} satisfies Sequential;
