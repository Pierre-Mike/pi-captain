// ── Step: API Documentation ───────────────────────────────────────────────
// Generates comprehensive API documentation from the implementation

import { file, retry } from "../gates/index.js";
import type { Step } from "../types.js";

export const apiDocs: Step = {
	kind: "step",
	label: "API Documentation",
	agent: "doc-writer",
	description: "Generate API documentation from the implementation",
	prompt:
		"You are a technical writer creating API documentation.\n\n" +
		"1. Document every endpoint: method, path, description, auth requirements\n" +
		"2. Show request/response examples with curl commands\n" +
		"3. Document all query parameters, headers, and body fields\n" +
		"4. Include error response examples for common failures\n" +
		"5. Add a quick-start guide with authentication setup\n" +
		"6. Write it in Markdown and save to docs/api.md\n\n" +
		"Implementation details:\n$INPUT\n\nOriginal request:\n$ORIGINAL",
	// Gate: docs file must exist after generation
	gate: file("docs/api.md"),
	onFail: retry(2),
	transform: { kind: "full" },
};
