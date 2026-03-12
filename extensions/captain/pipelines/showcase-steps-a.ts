// ── showcase-steps-a.ts — Showcase steps 1-7 (brainstorm → format) ──────────

import { retry, warn } from "../gates/on-fail.js";
import { regexCI } from "../gates/presets.js";
import { concat, rank } from "../merge.js";
import { extract, full, summarize } from "../transforms/presets.js";
import type { Gate, OnFail, Parallel, Pool, Step } from "../types.js";

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

export {
	brainstorm,
	challenge,
	expandParallel,
	rankPool,
	summarizeStep,
	formatStep,
};
