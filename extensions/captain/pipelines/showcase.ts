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
//   8. RETRY DEMO  — gate: regex ^\d+ fails first time → retry ×1
//   9. WARN DEMO   — gate: assert fails → warn (continues anyway)
//  10. FALLBACK    — gate: assert fails → fallback step
//  11. FINAL       — sequential wrapping everything with a none gate
//
// Run: captain_run { name: "captain:showcase", input: "list 5 hobbies" }
// Load: captain_load { action: "load", name: "captain:showcase" }

import type { Parallel, Pool, Runnable, Sequential, Step } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const flash = "flash";
const noTools: string[] = [];
const noGate = { type: "none" } as const;
const noFail = { action: "warn" } as const;
const full = { kind: "full" } as const;

// ─────────────────────────────────────────────────────────────────────────
// Step 1 — Basic step: raw input → numbered list of ideas
// ─────────────────────────────────────────────────────────────────────────

const brainstorm: Step = {
	kind: "step",
	label: "brainstorm",
	model: flash,
	tools: noTools,
	prompt: `You are a creative brainstormer.
Given this topic: "$INPUT"
Output a numbered list of exactly 5 short ideas (one per line).
Format: "1. <idea>"`,
	gate: noGate,
	onFail: noFail,
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
	gate: {
		type: "assert",
		fn: `output.includes("1.")`,
	},
	onFail: { action: "retry", max: 2 },
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
	merge: { strategy: "concat" },
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
	gate: {
		type: "regex",
		pattern: "^1\\.",
		flags: "m",
	},
	onFail: { action: "warn" },
	transform: full,
};

const rankPool: Pool = {
	kind: "pool",
	step: ranker,
	count: 3,
	merge: { strategy: "rank" },
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
	transform: { kind: "summarize" },
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
	gate: { type: "json" },
	onFail: { action: "retry", max: 2 },
	transform: { kind: "extract", key: "winner" },
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
	gate: {
		type: "assert",
		fn: `output.trim() === "42"`, // will always fail — output is a sentence
	},
	onFail: { action: "warn" },
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
	gate: {
		type: "assert",
		fn: `output.trim() !== "FAIL"`, // will always fail
	},
	onFail: { action: "fallback", step: fallbackStep },
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
	],
	gate: noGate,
} satisfies Sequential;
