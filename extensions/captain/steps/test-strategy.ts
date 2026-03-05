// ── Step: Test Strategy ───────────────────────────────────────────────────
// Designs a comprehensive test approach (run as a pool of 2, ranked)

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const testStrategy: Step = {
	kind: "step",
	label: "Test Strategy",
	agent: "tester",
	description: "Design test approach",
	prompt:
		"You are a QA engineer. Based on this architecture plan, design a comprehensive " +
		"test strategy covering:\n- Unit tests\n- Integration tests\n- Edge cases\n" +
		"- Performance considerations\n\nArchitecture plan:\n$INPUT\n\nOriginal request: $ORIGINAL",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
