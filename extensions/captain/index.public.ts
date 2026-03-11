// ── Captain Extension Public API ──────────────────────────────────────────
// Barrel export for commonly used captain presets and types.
// Import from this file to get all the presets in one go:
//
// import { bunTest, retry, full, concat, Runnable, Step } from "/path/to/captain/index.js"
//
// This avoids the need to import from individual files and provides better
// IDE autocomplete and IntelliSense support.

// ── OnFail Presets ─────────────────────────────────────────────────────────
export {
	fallback,
	retry,
	retryWithDelay,
	skip,
	warn,
} from "./gates/on-fail.js";
// ── Gate Presets ───────────────────────────────────────────────────────────
export {
	allOf,
	bunTest,
	command,
	file,
	regexCI,
	user,
} from "./gates/presets.js";
// ── Merge Presets ──────────────────────────────────────────────────────────
export {
	awaitAll,
	concat,
	firstPass,
	mergeFromStrategy,
	rank,
	vote,
} from "./merge.js";
// ── Transform Presets ──────────────────────────────────────────────────────
export {
	extract,
	full,
	summarize,
} from "./transforms/presets.js";

// ── Core Types ─────────────────────────────────────────────────────────────
export type {
	Gate,
	MergeFn,
	ModelId,
	OnFail,
	Parallel,
	Pool,
	Runnable,
	Sequential,
	Step,
	Transform,
} from "./types.js";
