// ── LLM Gates ─────────────────────────────────────────────────────────────
// Gates that call an LLM to evaluate step output.
// These require ctx.model and ctx.apiKey — heavier than pure gates.

import type { Api, Model } from "@mariozechner/pi-ai";
import { complete } from "@mariozechner/pi-ai";
import type { Gate, GateCtx } from "../core/types.js";

/** LLM gate using a fast/cheap model */
export function llmFast(prompt: string, threshold = 0.7): Gate {
	return async ({ output, ctx }) => {
		if (!(ctx?.model && ctx?.apiKey))
			return "LLM gate requires model and apiKey in context";

		const model = resolveModel("flash", ctx) ?? (ctx.model as Model<Api>);

		const response = await complete(
			model,
			{
				messages: [
					{
						role: "user",
						content: [{ type: "text", text: buildPrompt(prompt, output) }],
						timestamp: Date.now(),
					},
				],
			},
			{ apiKey: ctx.apiKey, maxTokens: 512, signal: ctx.signal },
		);

		const text = response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		const judgment = parseJudgment(text);

		return judgment.pass && judgment.confidence >= threshold
			? true
			: `LLM rejected (confidence: ${judgment.confidence.toFixed(2)}, threshold: ${threshold}): ${judgment.reason}`;
	};
}

// ── Helpers ───────────────────────────────────────────────────────────────

export const MAX_OUTPUT = 8000;

export function buildPrompt(criteria: string, output: string): string {
	const truncated = output.slice(0, MAX_OUTPUT);
	return [
		"You are a quality gate evaluator. Determine whether the output meets the criteria.",
		"",
		"## Criteria",
		criteria.replace(/\$OUTPUT/g, truncated),
		"",
		"## Output to Evaluate",
		truncated,
		"",
		"## Instructions",
		"Respond with ONLY a JSON object (no markdown fences):",
		'{ "pass": true/false, "confidence": 0.0-1.0, "reason": "brief explanation" }',
	].join("\n");
}

export interface Judgment {
	pass: boolean;
	confidence: number;
	reason: string;
}

export function parseJudgment(text: string): Judgment {
	const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = (jsonMatch ? (jsonMatch[1] ?? text) : text).trim();
	try {
		const parsed = JSON.parse(raw);
		return {
			pass: Boolean(parsed.pass),
			confidence:
				typeof parsed.confidence === "number"
					? Math.max(0, Math.min(1, parsed.confidence))
					: 0.5,
			reason: String(parsed.reason ?? "No reason given"),
		};
	} catch {
		const lower = text.toLowerCase();
		return {
			pass: lower.includes("pass") && !lower.includes("fail"),
			confidence: 0.5,
			reason: `Could not parse response: ${text.slice(0, 200)}`,
		};
	}
}

function resolveModel(modelName: string, ctx: GateCtx): Model<Api> | undefined {
	if (!ctx.modelRegistry) return ctx.model as Model<Api> | undefined;
	const currentProvider = (ctx.model as Model<Api> | undefined)?.provider;
	const providers = [
		currentProvider,
		"anthropic",
		"google",
		"openai",
		"openrouter",
		"deepseek",
	].filter((p): p is string => !!p);
	const seen = new Set<string>();
	for (const provider of providers) {
		if (seen.has(provider)) continue;
		seen.add(provider);
		try {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic registry lookup
			const found = (ctx.modelRegistry as any).find(provider, modelName);
			if (found) return found;
		} catch {
			/* try next */
		}
	}
	return ctx.model as Model<Api> | undefined;
}
