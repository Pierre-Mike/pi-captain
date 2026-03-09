// ── Step: Research ────────────────────────────────────────────────────────
// Deep dive into a topic, listing key findings and considerations

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a research agent. Thoroughly investigate the following topic.
List key findings, relevant details, and important considerations:

$ORIGINAL
`;

export const research: Step = {
	kind: "step",
	label: "Research",
	tools: ["read", "bash"],
	description: "Deep dive into the topic",
	prompt,
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
