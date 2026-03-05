// ── Step: Backend Implementation ──────────────────────────────────────────
// Builds the API and data layer based on the architecture plan

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const backendImplementation: Step = {
	kind: "step",
	label: "Backend Implementation",
	agent: "backend-dev",
	description: "Build the API and data layer",
	prompt:
		"You are a backend developer. Based on this architecture plan, implement the backend:\n" +
		"- API endpoints\n- Data models\n- Business logic\n- Error handling\n\n" +
		"Architecture plan:\n$INPUT\n\nOriginal request: $ORIGINAL",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
