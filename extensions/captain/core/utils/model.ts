// ── Model Resolution ──────────────────────────────────────────────────────
// Pure functions for resolving model identifier strings to Model objects.

import type { Api, Model } from "@mariozechner/pi-ai";

/** Model registry interface — for LLM gates and merge strategies */
export interface ModelRegistryLike {
	getAll(): Model<Api>[];
	find(provider: string, modelId: string): Model<Api> | undefined;
	getApiKey(model: Model<Api>): Promise<string | undefined>;
}

/** Returns true if the model ID looks like a dated snapshot (e.g. claude-sonnet-4-5-20250929). */
function isDatedModel(id: string): boolean {
	return /\d{8}$/.test(id);
}

/**
 * Score a model ID for sorting: higher = better (more current, preferred).
 * Ranking strategy (Anthropic-style):
 *   1. New-style alias with no date  e.g. claude-sonnet-4-5         → score 3
 *   2. New-style dated snapshot      e.g. claude-sonnet-4-5-20250929 → score 2
 *   3. Old-style alias               e.g. claude-3-7-sonnet-latest   → score 1
 *   4. Old-style dated snapshot      e.g. claude-3-5-sonnet-20240620 → score 0
 *
 * "New-style" = matches `claude-<name>-<digit>` (no "3-N-" prefix).
 */
function modelScore(id: string): number {
	const lower = id.toLowerCase();
	// New-style: "claude-" then a word, then a digit version — NOT "claude-3-"
	const isNewStyle = /^claude-(?!\d)/.test(lower);
	const dated = isDatedModel(lower);
	if (isNewStyle && !dated) return 3;
	if (isNewStyle && dated) return 2;
	if (!(isNewStyle || dated)) return 1;
	return 0;
}

/** Resolve a model identifier string (e.g. "sonnet") to a Model object via the registry.
 * Prefers models from the same provider as the fallback (current session model) to avoid
 * accidentally resolving to Amazon Bedrock or other providers when multiple providers
 * have models with the same ID.
 * Among partial matches, ranks by modelScore so that `model: "sonnet"` resolves to
 * the most current available alias (e.g. `claude-sonnet-4-5`) rather than an old dated
 * snapshot (`claude-3-5-sonnet-20240620`) or a deprecated `-latest` alias. */
export function resolveModel(
	pattern: string,
	registry: ModelRegistryLike,
	fallback: Model<Api>,
): Model<Api> {
	const all = registry.getAll();
	const lower = pattern.toLowerCase();
	const sameProvider = (m: Model<Api>) => m.provider === fallback.provider;

	// 1. Exact id match within same provider
	const exactSameProvider = all.find(
		(m) => m.id.toLowerCase() === lower && sameProvider(m),
	);
	if (exactSameProvider) return exactSameProvider;

	// 2. Partial match within same provider (name or id), ranked by modelScore.
	const partialMatches = all.filter(
		(m) =>
			sameProvider(m) &&
			(m.id.toLowerCase().includes(lower) ||
				(m as { name?: string }).name?.toLowerCase().includes(lower)),
	);
	if (partialMatches.length > 0) {
		partialMatches.sort((a, b) => modelScore(b.id) - modelScore(a.id));
		return partialMatches[0];
	}

	// 3. No match in current provider — fall back to session model to avoid
	//    accidentally resolving to a different provider (e.g. Amazon Bedrock)
	//    that the user may not have credentials for.
	return fallback;
}
