// ── Step: Frontend Implementation ─────────────────────────────────────────
// Builds the UI components based on the architecture plan

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const frontendImplementation: Step = {
	kind: "step",
	label: "Frontend Implementation",
	agent: "frontend-dev",
	description: "Build the UI components",
	prompt:
		"You are a frontend developer. Based on this architecture plan, implement the frontend:\n" +
		"- UI components\n- State management\n- User interactions\n- Styling\n\n" +
		"Architecture plan:\n$INPUT\n\nOriginal request: $ORIGINAL",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
