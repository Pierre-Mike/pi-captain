// ── Step: Refactor Code ───────────────────────────────────────────────────
// Applies the refactoring plan while preserving existing behavior

import { retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are a developer performing a carefully planned refactoring.

1. Follow the refactoring plan from the analysis step
2. Make changes incrementally — one module at a time
3. Preserve ALL existing behavior (this is refactoring, not feature work)
4. Improve naming, reduce duplication, simplify control flow
5. Update imports and references across the codebase
6. List every file modified with a brief description of the change

Refactoring plan:
$INPUT

Original request:
$ORIGINAL
`;

export const refactorCode: Step = {
	kind: "step",
	label: "Refactor Code",
	tools: ["read", "bash", "edit", "write"],
	description: "Apply refactoring changes based on the analysis plan",
	prompt,
	onFail: retry,
	transform: { kind: "full" },
};
