// ── Step: Performance Review ──────────────────────────────────────────────
// Reviews code for performance issues and optimization opportunities

import { outputMinLength, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const performanceReview: Step = {
	kind: "step",
	label: "Performance Review",
	agent: "reviewer",
	description:
		"Review code for performance bottlenecks and optimization opportunities",
	prompt:
		"You are a performance engineer reviewing code.\n\n" +
		"Analyze for:\n" +
		"1. O(n²) or worse algorithms that could be optimized\n" +
		"2. Unnecessary allocations, copies, or re-renders\n" +
		"3. Missing caching opportunities\n" +
		"4. N+1 query patterns or excessive I/O\n" +
		"5. Blocking operations in hot paths\n" +
		"6. Memory leaks (event listeners, timers, closures)\n" +
		"7. Bundle size impact (large imports, tree-shaking issues)\n\n" +
		"For each finding, report:\n" +
		"- Impact: HIGH / MEDIUM / LOW\n" +
		"- Location: file and function\n" +
		"- Current behavior and suggested optimization\n\n" +
		"Code to review:\n$INPUT\n\nContext:\n$ORIGINAL",
	gate: outputMinLength(100),
	onFail: retry(2),
	transform: { kind: "full" },
};
