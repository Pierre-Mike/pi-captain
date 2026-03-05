// ── Step: API Design ──────────────────────────────────────────────────────
// Designs the API contract: endpoints, schemas, auth, error codes

import { assert, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const apiDesignStep: Step = {
	kind: "step",
	label: "API Design",
	agent: "architect",
	description:
		"Design the API contract including endpoints, schemas, and error handling",
	prompt:
		"You are an API architect. Design a complete API specification.\n\n" +
		"Include:\n" +
		"1. Endpoint definitions (method, path, description)\n" +
		"2. Request/response schemas with TypeScript types\n" +
		"3. Authentication & authorization requirements\n" +
		"4. Error response format and status codes\n" +
		"5. Rate limiting and pagination strategy\n" +
		"6. Versioning approach\n" +
		"7. Data validation rules for each field\n\n" +
		"Output the design as a structured document with code blocks for types.\n\n" +
		"API requirements:\n$ORIGINAL",
	// Gate: design must include endpoint definitions
	gate: assert(
		"output.includes('GET') || output.includes('POST') || output.includes('endpoint') || output.includes('route')",
	),
	onFail: retry(2),
	transform: { kind: "full" },
};
