/**
 * Web Search Extension
 *
 * Registers a `web_search` tool that the LLM can call to search the internet.
 * Uses Anthropic's native web search beta (anthropic-beta: web-search-2025-03-05)
 * so results come directly from Anthropic — no third-party search API key needed.
 *
 * The search is always run via claude-haiku-4-5 (the fastest/cheapest model)
 * regardless of which model is active in the session, since it's just doing
 * retrieval and summarisation — not the main reasoning task.
 *
 * The tool returns a concise summary with source URLs that the calling model
 * can use to answer the user's question.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { runWebSearch, SEARCH_MODEL_ID, type SearchResult } from "./fetch.js";

export default function webSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			`Search the internet for current information. Uses Anthropic's native web search ` +
			`via ${SEARCH_MODEL_ID}. Returns a concise summary with source URLs. ` +
			`Use when you need up-to-date facts, documentation, news, or anything not in your training data.`,
		parameters: Type.Object({
			query: Type.String({
				description:
					"The search query. Be specific and concise for best results.",
			}),
		}),

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const model = ctx.modelRegistry.find("anthropic", SEARCH_MODEL_ID);
			if (!model) {
				return {
					content: [
						{
							type: "text",
							text: `Error: model ${SEARCH_MODEL_ID} not found in registry`,
						},
					],
					details: { query: params.query, error: "model not found" },
					isError: true,
				};
			}

			const apiKey = await ctx.modelRegistry.getApiKey(model);
			if (!apiKey) {
				return {
					content: [
						{
							type: "text",
							text: `Error: no API key available for ${SEARCH_MODEL_ID}`,
						},
					],
					details: { query: params.query, error: "no api key" },
					isError: true,
				};
			}

			onUpdate?.({
				content: [{ type: "text", text: `Searching: ${params.query}` }],
				details: { query: params.query, status: "searching" },
			});

			const result: SearchResult = await runWebSearch(
				params.query,
				apiKey,
				signal,
			);

			if (!result.ok) {
				const errorResult = result as { ok: false; error: string };
				return {
					content: [
						{ type: "text", text: `Search failed: ${errorResult.error}` },
					],
					details: { query: params.query, error: errorResult.error },
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: result.text }],
				details: { query: params.query, result: result.text },
			};
		},

		renderCall(args, theme) {
			const query = typeof args.query === "string" ? args.query : "";
			const preview = query.length > 60 ? `${query.slice(0, 60)}…` : query;
			return new Text(
				theme.fg("toolTitle", theme.bold("web_search ")) +
					theme.fg("dim", `"${preview}"`),
				0,
				0,
			);
		},

		renderResult(result, { expanded, isPartial }, theme) {
			const details = result.details as
				| { query?: string; result?: string; error?: string; status?: string }
				| undefined;

			if (isPartial) {
				const query = details?.query ?? "";
				return new Text(
					theme.fg("toolTitle", "web_search ") +
						theme.fg("muted", `searching: "${query}"…`),
					0,
					0,
				);
			}

			if (details?.error) {
				return new Text(
					theme.fg(
						"error",
						`✗ Search failed: ${details?.error ?? "unknown error"}`,
					),
					0,
					0,
				);
			}

			const text = details?.result ?? "";
			if (!text) {
				return new Text(theme.fg("muted", "✓ No results"), 0, 0);
			}

			if (expanded) {
				return new Text(text, 0, 0);
			}

			// Collapsed: show first two lines as a preview
			const lines = text.split("\n").filter((l) => l.trim());
			const preview = lines.slice(0, 2).join(" ").slice(0, 120);
			const hasMore = lines.length > 2 || text.length > 120;
			return new Text(
				theme.fg("success", "✓ ") +
					theme.fg("toolOutput", preview) +
					(hasMore ? theme.fg("dim", " … (Ctrl+O to expand)") : ""),
				0,
				0,
			);
		},
	});
}
