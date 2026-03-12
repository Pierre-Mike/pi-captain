// ── Captain Pipeline Generator ─────────────────────────────────────────────
// Uses LLM to generate TypeScript pipeline files on-the-fly.
// The LLM produces a complete .ts file using the same format as hand-written
// pipelines — fully type-safe, no JSON deserialization needed.

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";

// ── Build the LLM prompt ──────────────────────────────────────────────────

/** Build a structured prompt instructing the LLM to produce a TypeScript pipeline file */
export function buildGeneratorPrompt(userGoal: string): string {
	return `You are a pipeline architect for the Captain orchestration system.
Your job is to generate a complete, executable TypeScript pipeline file based on the user's goal.

## Output Format
Respond with ONLY a valid TypeScript file. No explanation outside the file. No markdown fences.

The file MUST start with these two comment lines (no blank line before them):
// @name: <kebab-case-pipeline-name>
// @description: <one-line description>

Then the full TypeScript module using ONLY these imports:
- import { retry, retryWithDelay, skip, warn, fallback, bunTest, command, file as fileGate, regexCI, user, allOf, llmFast, full, summarize, extract, concat, awaitAll, firstPass, vote, rank } from "./captain.ts";
- import type { Gate, OnFail, Runnable, Step } from "./captain.ts";

The file MUST end with:
export const pipeline: Runnable = { ... };

## Step shape
\`\`\`ts
const myStep: Step = {
  kind: "step",
  label: "Human-readable name",
  model: "sonnet",          // optional: "sonnet" | "flash" | omit for session default
  tools: ["read", "bash", "edit", "write"],
  prompt: "Do X based on: $INPUT\\n\\nOriginal goal: $ORIGINAL",
  gate: bunTest,            // or: command("npm test"), file("dist/out.js"), regexCI("^ok"), user, undefined
  onFail: retry(3),         // or: skip, warn, retryWithDelay(3, 2000), fallback(otherStep)
  transform: full,          // or: summarize(), extract("key")
};
\`\`\`

## Composition
\`\`\`ts
// Sequential — output chains via $INPUT
export const pipeline: Runnable = { kind: "sequential", steps: [stepA, stepB, stepC] };

// Parallel — different steps concurrently (git worktree isolation)
export const pipeline: Runnable = { kind: "parallel", steps: [frontendStep, backendStep], merge: concat };

// Pool — same step × N concurrently
export const pipeline: Runnable = { kind: "pool", step: solveStep, count: 3, merge: vote };
\`\`\`

## Rules
1. Use $INPUT to reference the previous step's output; $ORIGINAL for the user's initial request.
2. Use meaningful labels and clear, detailed prompts.
3. Choose gates wisely — undefined for exploratory steps, command() for shell checks, bunTest for test suites, llmFast() for quality checks.
4. Choose onFail wisely — retry(3) for critical steps, skip for optional ones, warn for non-blocking.
5. Use parallel/pool when steps are independent; sequential when output must chain.
6. Keep pipelines focused — 3–7 steps is ideal.
7. Do NOT invent imports. Only use what is listed above.
8. Do NOT add any text outside the TypeScript file.
9. In step prompts for parallel/pool branches, always include an explicit instruction to use only relative paths for all file operations (read, write, edit, bash). Parallel and pool steps run in isolated git worktrees and must never write to absolute paths.

## User's Goal
${userGoal}`;
}

// ── Parse & Validate ──────────────────────────────────────────────────────

export interface GeneratedPipeline {
	name: string;
	description: string;
	tsSource: string;
}

/** Extract @name / @description from the leading comment lines and return the full TS source */
export function parseGeneratedPipeline(raw: string): GeneratedPipeline {
	// Strip markdown code fences if the LLM wrapped the output anyway
	let source = raw.trim();
	const fenceMatch = source.match(/```(?:ts|typescript)?\s*([\s\S]*?)```/);
	if (fenceMatch) source = fenceMatch[1]?.trim() ?? source;

	const nameMatch = source.match(/^\/\/\s*@name:\s*(.+)$/m);
	const descMatch = source.match(/^\/\/\s*@description:\s*(.+)$/m);

	if (!nameMatch) {
		throw new Error(
			"Generated pipeline is missing the required `// @name: <name>` header comment.\n\n" +
				`Raw output (first 500 chars):\n${raw.slice(0, 500)}`,
		);
	}

	const name = nameMatch[1].trim();
	const description = descMatch ? descMatch[1].trim() : "";

	if (!source.includes("export const pipeline")) {
		throw new Error(
			"Generated pipeline does not export a `pipeline` const.\n\n" +
				`Raw output (first 500 chars):\n${raw.slice(0, 500)}`,
		);
	}

	return { name, description, tsSource: source };
}

// ── Generate Pipeline via LLM ─────────────────────────────────────────────

/** Call the LLM to generate a TypeScript pipeline file */
export async function generatePipeline(
	userGoal: string,
	model: Model<Api>,
	apiKey: string,
	signal?: AbortSignal,
): Promise<GeneratedPipeline> {
	const prompt = buildGeneratorPrompt(userGoal);

	const response = await complete(
		model,
		{
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{ apiKey, maxTokens: 4096, signal },
	);

	const raw = response.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("\n");

	return parseGeneratedPipeline(raw);
}
