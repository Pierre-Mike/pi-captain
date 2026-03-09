// ── Pipeline Select Helpers ─────────────────────────────────────────────────
// Utility functions for building and parsing dropdown options for pipeline
// selection in the captain_run tool's interactive UI flow.

import type { CaptainState } from "../state.js";

/**
 * Build the list of select options to present to the user.
 * Loaded pipelines appear first (labeled "(loaded)"), then unloaded builtin
 * presets appear after (labeled "(builtin)"). A builtin that is already loaded
 * appears only once as "(loaded)".
 */
export function buildPipelineSelectOptions(state: CaptainState): string[] {
	const loadedNames = Object.keys(state.pipelines);
	const loadedSet = new Set(loadedNames);

	const loadedOptions = loadedNames.map((name) => `${name} (loaded)`);

	const builtinOptions = Object.keys(state.builtinPresetMap)
		.filter((name) => !loadedSet.has(name))
		.map((name) => `${name} (builtin)`);

	return [...loadedOptions, ...builtinOptions];
}

/**
 * Strip the " (loaded)" or " (builtin)" suffix from a select option to
 * recover the original pipeline name.
 */
export function parsePipelineSelectOption(option: string): string {
	return option.replace(/\s+\((loaded|builtin)\)$/, "");
}
