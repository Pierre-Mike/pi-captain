// ── Step: Summarize ───────────────────────────────────────────────────────
// Produces a clear, structured summary with actionable insights from research

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a summarization agent. Take these research findings and produce
a clear, well-structured summary with actionable insights:

$INPUT

Original question: $ORIGINAL
`;

export const summarize: Step = {
	kind: "step",
	label: "Summarize",
	tools: ["read", "bash"],
	description: "Produce a clear summary",
	prompt,
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
