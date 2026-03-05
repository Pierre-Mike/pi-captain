// ── Step: Refactor Code ───────────────────────────────────────────────────
// Applies the refactoring plan while preserving existing behavior

import { none, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const refactorCode: Step = {
	kind: "step",
	label: "Refactor Code",
	agent: "backend-dev",
	description: "Apply refactoring changes based on the analysis plan",
	prompt:
		"You are a developer performing a carefully planned refactoring.\n\n" +
		"1. Follow the refactoring plan from the analysis step\n" +
		"2. Make changes incrementally — one module at a time\n" +
		"3. Preserve ALL existing behavior (this is refactoring, not feature work)\n" +
		"4. Improve naming, reduce duplication, simplify control flow\n" +
		"5. Update imports and references across the codebase\n" +
		"6. List every file modified with a brief description of the change\n\n" +
		"Refactoring plan:\n$INPUT\n\nOriginal request:\n$ORIGINAL",
	gate: none,
	onFail: retry(2),
	transform: { kind: "full" },
};
