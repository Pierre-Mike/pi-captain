/**
 * Web Search Fetch Implementation
 *
 * Contains the core web search logic using Anthropic's web search beta API.
 */

export const SEARCH_MODEL_ID = "claude-haiku-4-5";
export const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
export const MAX_USES = 5;
export const MAX_TOKENS = 2048;

export type SearchResult =
	| { ok: true; text: string }
	| { ok: false; error: string };

export async function runWebSearch(
	query: string,
	apiKey: string,
	signal?: AbortSignal,
): Promise<SearchResult> {
	const isOAuth = apiKey.includes("sk-ant-oat");

	const headers: Record<string, string> = isOAuth
		? {
				authorization: `Bearer ${apiKey}`,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "web-search-2025-03-05,oauth-2025-04-20",
				"content-type": "application/json",
				"x-app": "cli",
				"user-agent": "claude-cli/1.0.72 (external, cli)",
			}
		: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "web-search-2025-03-05",
				"content-type": "application/json",
			};

	const body = {
		model: SEARCH_MODEL_ID,
		max_tokens: MAX_TOKENS,
		temperature: 0,
		system:
			"You are a concise web research assistant. Search the web and return a focused summary with key findings and full source URLs. Be brief and direct.",
		tools: [
			{
				type: "web_search_20250305",
				name: "web_search",
				max_uses: MAX_USES,
			},
		],
		messages: [
			{
				role: "user",
				content: query,
			},
		],
	};

	let res: Response;
	try {
		res = await fetch(ANTHROPIC_API_URL, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
			signal,
		});
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { ok: false, error: `Network error: ${msg}` };
	}

	const raw = await res.text();

	if (!res.ok) {
		return {
			ok: false,
			error: `Anthropic API error (${res.status}): ${raw.slice(0, 300)}`,
		};
	}

	let parsed: { content?: Array<{ type: string; text?: string }> };
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, error: "Failed to parse Anthropic response as JSON" };
	}

	const text = (parsed.content ?? [])
		.filter(
			(b): b is { type: "text"; text: string } =>
				b.type === "text" && typeof b.text === "string",
		)
		.map((b) => b.text)
		.join("\n\n")
		.trim();

	if (!text) {
		return { ok: false, error: "Anthropic returned no text content" };
	}

	return { ok: true, text };
}
