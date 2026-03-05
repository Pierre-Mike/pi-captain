// ── Step: Integration & Tests ─────────────────────────────────────────────
// Writes and runs integration tests against the parallel implementation output

import { none, skip } from "../gates/index.js";
import type { Step } from "../types.js";

export const integrationTests: Step = {
	kind: "step",
	label: "Integration & Tests",
	agent: "tester",
	description: "Write and run tests against the implementation",
	prompt:
		"You are a test engineer. Given the following implementation output from parallel development, " +
		"write integration tests and verify everything works together:\n\n$INPUT\n\n" +
		"Original request: $ORIGINAL\n\nWrite tests, then describe the results.",
	gate: none,
	onFail: skip,
	transform: { kind: "full" },
};
