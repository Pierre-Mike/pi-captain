// ── Merge Strategy Implementations ────────────────────────────────────────

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { MergeStrategy } from "./types.js";

interface MergeContext {
	model: Model<Api>;
	apiKey: string;
	signal?: AbortSignal;
}

// Max chars per branch output when sending to LLM merge (prevent context overflow)
const MAX_BRANCH_CHARS = 6000;

/** Truncate text to a max length, appending a notice if trimmed */
function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n…(truncated)`;
}

/** Merge multiple outputs according to strategy */
export async function mergeOutputs(
	strategy: MergeStrategy,
	outputs: string[],
	mctx: MergeContext,
): Promise<string> {
	// Filter out empty outputs
	const valid = outputs.filter((o) => o.trim().length > 0);
	if (valid.length === 0) return "(no output)";
	if (valid.length === 1) return valid[0];

	switch (strategy) {
		case "concat":
			// Simply join all outputs with separators
			return valid.map((o, i) => `--- Branch ${i + 1} ---\n${o}`).join("\n\n");

		case "awaitAll":
			// Same as concat but semantically means "wait for all before proceeding"
			return valid.map((o, i) => `--- Branch ${i + 1} ---\n${o}`).join("\n\n");

		case "firstPass":
			// Return the first non-empty output
			return valid[0];

		case "vote": {
			// Ask LLM to pick the most common/best answer via voting
			const prompt = [
				"You are a merge judge. Multiple agents produced the following outputs for the same task.",
				"Pick the best answer or synthesize the most common consensus. Return ONLY the final answer.\n",
				...valid.map(
					(o, i) => `## Output ${i + 1}\n${truncate(o, MAX_BRANCH_CHARS)}\n`,
				),
			].join("\n");

			return await llmMerge(prompt, mctx);
		}

		case "rank": {
			// Ask LLM to rank and synthesize
			const prompt = [
				"You are a merge judge. Multiple agents produced the following outputs.",
				"Rank them by quality, then synthesize the best parts into a single coherent answer.\n",
				...valid.map(
					(o, i) => `## Output ${i + 1}\n${truncate(o, MAX_BRANCH_CHARS)}\n`,
				),
			].join("\n");

			return await llmMerge(prompt, mctx);
		}

		default:
			return valid.join("\n\n");
	}
}

/** Helper: call LLM for merge decisions */
async function llmMerge(prompt: string, mctx: MergeContext): Promise<string> {
	try {
		const response = await complete(
			mctx.model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: prompt }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey: mctx.apiKey, maxTokens: 4096, signal: mctx.signal },
		);

		return response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");
	} catch (err) {
		// Fallback to concat if LLM call fails
		return `(merge error: ${err instanceof Error ? err.message : String(err)})`;
	}
}
