// ── showcase-steps-b.ts — Showcase steps 8-12 (warn → retry demos) ──────────

import { llmFast } from "../gates/llm.js";
import { fallback as onFailFallback, retry, warn } from "../gates/on-fail.js";
import { full } from "../transforms/presets.js";
import type { Gate, OnFail, Step } from "../types.js";

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

const flash = "flash";
const noTools: string[] = [];
const noGate: Gate = () => true;
const noFail: OnFail = warn;

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

export {
	warnDemo,
	fallbackDemo,
	toolDemo,
	webSearchDemo,
	llmFastDemo,
	retryDemo,
};
