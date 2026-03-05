// ── Pipeline: Documentation Generation ────────────────────────────────────
// Parallel doc generation (API + architecture + usage guide) → review.
// Each branch creates a different doc file, checked by file-existence gates.
// The review step cross-references docs against source for accuracy.
//
// Structure:
//   sequential
//   ├── parallel (merge: concat)
//   │   ├── step: API Documentation (gate: file docs/api.md)
//   │   ├── step: Architecture Docs (gate: file docs/architecture.md)
//   │   └── step: Usage Guide (gate: file docs/guide.md)
//   └── step: Documentation Review (transform: summarize)
// Agents: doc-writer, reviewer (from ~/.pi/agent/agents/*.md)

import {
	apiDocs,
	architectureDocs,
	docsReview,
	usageGuide,
} from "../steps/index.js";
import type { Runnable } from "../types.js";

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		// 1. Three parallel doc generation branches
		// Each writes to a different file, checked by file-existence gate
		{
			kind: "parallel",
			steps: [apiDocs, architectureDocs, usageGuide],
			merge: { strategy: "concat" },
		},

		// 2. Review all generated docs for accuracy
		docsReview,
	],
};
