// ── Step: Generate Execution Spec ─────────────────────────────────────────
// Stage 7 of shredder: Convert the task tree into an executable captain
// pipeline JSON spec that can be loaded and run directly.

import { file, retry } from "../gates/index.js";
import type { Step } from "../types.js";

const prompt = `
You are the Execution Spec Generator. Convert the task tree into a valid captain pipeline JSON spec.

Task tree:
$INPUT

Original requirement:
$ORIGINAL

Instructions:
1. Map each execution layer to a parallel node (units within a layer run concurrently)
2. Map cross-layer dependencies to sequential ordering (layers run in order)
3. Assign tools/model to each unit based on its domain:
   - Code generation → tools: ["read","bash","edit","write"]
   - Testing → tools: ["read","bash","edit","write"]
   - Documentation → tools: ["read","bash","edit","write"]
   - Architecture / design → tools: ["read","bash"]
   - Research / investigation → tools: ["read","bash"]
   - Review → tools: ["read","bash","grep","find","ls"]
4. Each unit becomes a Step with: kind, label, tools, description, prompt, gate, onFail, transform
5. Each layer becomes a Parallel node wrapping its unit Steps
6. The top-level pipeline is a Sequential node containing all layer Parallel nodes in order

The output JSON must match the Runnable type:
- Step: { kind: 'step', label, tools, description, prompt,
  gate: { type: 'none' }, onFail: { action: 'retry', max: 2 }, transform: { kind: 'full' } }
- Sequential: { kind: 'sequential', steps: [Runnable...] }
- Parallel: { kind: 'parallel', steps: [Runnable...], merge: { strategy: 'awaitAll' } }

Write the JSON spec to execution-spec.json using the write tool.
Also output the full JSON in a \`\`\`json code block.
`;

export const generateExecutionSpec: Step = {
	kind: "step",
	label: "Generate Execution Spec",
	tools: ["read", "bash"],
	model: "flash",
	temperature: 0,
	description:
		"Convert the task tree into an executable captain pipeline JSON spec",
	prompt,
	gate: file("execution-spec.json"),
	onFail: retry(2),
	transform: { kind: "full" },
};
