// ── YAML Frontmatter Parser ────────────────────────────────────────────────
// Parses YAML-style frontmatter from .md agent files into a key-value map.
// Supports: scalars, comma-separated lists, YAML list syntax, booleans, numbers.
// No external YAML dependency — works with any provider's .md agent format.

/** Try to match a YAML list item line; returns the trimmed value or null. */
export function parseListItem(line: string): string | null {
	const m = line.match(/^\s+-\s+(.+)/);
	return m ? m[1].trim() : null;
}

/**
 * Coerce a raw (already-unquoted) YAML scalar string to the right JS type.
 * Returns a boolean, number, string[], or string.
 */
export function parseScalarValue(
	unquoted: string,
): string | string[] | number | boolean {
	if (unquoted === "true") return true;
	if (unquoted === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(unquoted)) return Number(unquoted);
	if (unquoted.includes(",")) return unquoted.split(",").map((s) => s.trim());
	return unquoted;
}

/** Flush a pending list accumulator into result. */
export function flushPendingList(
	result: Record<string, string | string[] | number | boolean>,
	key: string,
	listItems: string[] | null,
): void {
	if (listItems && key) result[key] = listItems;
}

/**
 * Process a key-value line; updates result and returns the new currentKey.
 * Returns null if the line is not a key-value pair.
 */
export function parseKeyValue(
	line: string,
	result: Record<string, string | string[] | number | boolean>,
): string | null {
	const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)/);
	if (!kvMatch) return null;
	const key = kvMatch[1];
	const rawValue = kvMatch[2].trim();
	// Empty value — could be followed by YAML list items
	if (rawValue) {
		const unquoted = rawValue.replace(/^["']|["']$/g, "");
		result[key] = parseScalarValue(unquoted);
	}
	return key;
}

/**
 * Parse YAML-style frontmatter into a key-value map.
 * Handles: scalar values, comma-separated lists, YAML list syntax (  - item),
 * quoted strings, numeric values, and multi-line descriptions.
 */
export function parseFrontmatter(
	raw: string,
): Record<string, string | string[] | number | boolean> {
	const result: Record<string, string | string[] | number | boolean> = {};
	const lines = raw.split("\n");
	let currentKey = "";
	let listItems: string[] | null = null;

	for (const line of lines) {
		// YAML list item (  - value) — belongs to the current key
		const item = parseListItem(line);
		if (item !== null && currentKey) {
			if (!listItems) listItems = [];
			listItems.push(item);
			continue;
		}

		// Flush any pending list before processing the next key
		if (listItems && currentKey) {
			flushPendingList(result, currentKey, listItems);
			listItems = null;
		}

		// Key: value pair (top-level, no leading whitespace)
		const newKey = parseKeyValue(line, result);
		if (newKey !== null) currentKey = newKey;
	}

	// Flush final pending list
	flushPendingList(result, currentKey, listItems);

	return result;
}
