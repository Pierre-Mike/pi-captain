// ── Transform Presets — reusable output transform functions ───────────────
// Each preset is a Transform function: ({ output, original, ctx }) => string | Promise<string>
// Write your own inline for custom behaviour — it's just a function.

import type { Transform, TransformCtx } from "../types.js";

// ── Presets ───────────────────────────────────────────────────────────────

/** Pass the entire step output unchanged (default) */
export const full: Transform = ({ output }) => output;

/**
 * Extract a single key from a JSON object in the output.
 * Falls back to the raw output if parsing fails.
 */
export function extract(key: string): Transform {
	return ({ output }) => {
		try {
			const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/) || [
				null,
				output,
			];
			const parsed = JSON.parse(jsonMatch[1]?.trim());
			return String(parsed[key] ?? output);
		} catch {
			return output;
		}
	};
}

/**
 * Ask the LLM to summarize the output in 2-3 sentences.
 * Requires a model and apiKey in ctx; falls back to raw output on error.
 */
export function summarize(): Transform {
	return async ({
		output,
		ctx,
	}: {
		output: string;
		original: string;
		ctx: TransformCtx;
	}) => {
		if (!(ctx.model && ctx.apiKey)) return output;
		try {
			// Dynamic import to avoid circular deps
			const { complete } = await import("@mariozechner/pi-ai");
			const response = await complete(
				ctx.model,
				{
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: `Summarize concisely in 2-3 sentences:\n\n${output.slice(0, 4000)}`,
								},
							],
							timestamp: Date.now(),
						},
					],
				},
				{ apiKey: ctx.apiKey, maxTokens: 512, signal: ctx.signal },
			);
			return response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n");
		} catch {
			return output;
		}
	};
}
