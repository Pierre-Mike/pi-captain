// ── Step: Architecture Plan ───────────────────────────────────────────────
// Designs the architecture and breaks the feature into modules

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const architecturePlan: Step = {
	kind: "step",
	label: "Architecture Plan",
	agent: "architect",
	description: "Design the architecture and break into modules",
	prompt:
		"You are a software architect. Analyze this feature request and produce a detailed " +
		"implementation plan. Include:\n- File structure\n- Data models\n- API endpoints\n" +
		"- Frontend components\n- Dependencies between modules\n\nFeature request:\n$ORIGINAL",
	gate: assert("output.toLowerCase().includes('file')"),
	onFail: retry(2),
	transform: { kind: "full" },
};
