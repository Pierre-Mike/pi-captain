// ── Step: API Implementation ──────────────────────────────────────────────
// Implements the API from the approved design spec

import { command, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const apiImplementation: Step = {
	kind: "step",
	label: "API Implementation",
	agent: "backend-dev",
	description: "Implement the API endpoints from the approved design",
	prompt:
		"You are a backend developer implementing an API from a design spec.\n\n" +
		"1. Implement each endpoint with proper request parsing and validation\n" +
		"2. Use Bun.serve() with typed routes (not express)\n" +
		"3. Implement all TypeScript types from the design\n" +
		"4. Add error handling with proper HTTP status codes\n" +
		"5. Implement input validation for every field\n" +
		"6. Add request logging and timing\n" +
		"7. Write each handler in a separate file for maintainability\n\n" +
		"API design:\n$INPUT\n\nOriginal request:\n$ORIGINAL",
	// Gate: TypeScript must compile
	gate: command("bunx tsc --noEmit"),
	onFail: retry(3),
	transform: { kind: "full" },
};
