// ── Step: Research ────────────────────────────────────────────────────────
// Deep dive into a topic, listing key findings and considerations

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const research: Step = {
	kind: "step",
	label: "Research",
	agent: "researcher",
	description: "Deep dive into the topic",
	prompt:
		"You are a research agent. Thoroughly investigate the following topic. " +
		"List key findings, relevant details, and important considerations:\n\n$ORIGINAL",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
