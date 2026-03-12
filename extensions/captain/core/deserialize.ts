// ── Runnable Deserialization ───────────────────────────────────────────────
// JSON pipelines store gate/onFail as plain objects (serializable).
// This module converts them to their function equivalents before execution.
//
// Gate JSON shape:   { type: "none" | "command" | "user" | ... }
// OnFail JSON shape: { action: "retry" | "retryWithDelay" | "skip" | "warn" | "fallback", max?, delayMs? }
// retryWithDelay is sugar: deserialized to retryWithDelay(max, delayMs) preset.

import {
	fallback,
	retry,
	retryWithDelay,
	skip,
	warn,
} from "../gates/on-fail.js";
import { command, file, regexCI, user } from "../gates/presets.js";
import { mergeFromStrategy } from "../merge.js";
import { extract, full, summarize } from "../transforms/presets.js";
import type {
	Gate,
	MergeFn,
	OnFail,
	Runnable,
	Step,
	Transform,
} from "../types.js";

// ── Gate deserialization ──────────────────────────────────────────────────

type RawGate = {
	type: string;
	value?: string;
	pattern?: string;
	gates?: RawGate[];
};

function deserializeGate(raw: unknown): Gate | undefined {
	if (!raw || typeof raw === "function") return raw as Gate | undefined;
	const g = raw as RawGate;

	switch (g.type) {
		case "none":
		case undefined:
			return undefined;
		case "command":
			return command(g.value ?? "true");
		case "file":
			return file(g.value ?? "");
		case "regex":
			return regexCI(g.pattern ?? g.value ?? "");
		case "user":
			return user;
		case "multi": {
			// handled below via allOf/anyOf if needed
			return undefined;
		}
		default:
			return undefined;
	}
}

// ── OnFail deserialization ────────────────────────────────────────────────

type RawOnFail = {
	action: string;
	max?: number;
	delayMs?: number;
	step?: unknown;
};

function deserializeOnFail(raw: unknown): OnFail | undefined {
	if (!raw || typeof raw === "function") return raw as OnFail | undefined;
	const o = raw as RawOnFail;

	switch (o.action) {
		case "retry":
			return retry(o.max);
		case "retryWithDelay":
			return retryWithDelay(o.max, o.delayMs ?? 1000);
		case "skip":
			return skip;
		case "warn":
			return warn;
		case "fallback": {
			if (!o.step) return skip; // fallback without step degrades to skip
			const step = deserializeStep(o.step as Step);
			return fallback(step);
		}
		default:
			return undefined;
	}
}

// ── Transform deserialization ─────────────────────────────────────────────

type RawTransform = { kind: "full" | "extract" | "summarize"; key?: string };

function deserializeTransform(raw: unknown): Transform {
	if (typeof raw === "function") return raw as Transform;
	const t = raw as RawTransform | undefined;
	if (!t || t.kind === "full") return full;
	if (t.kind === "extract") return extract(t.key ?? "");
	if (t.kind === "summarize") return summarize();
	return full;
}

// ── Merge deserialization ─────────────────────────────────────────────────

type RawMerge = { strategy?: string };

function deserializeMerge(raw: unknown): MergeFn {
	if (typeof raw === "function") return raw as MergeFn;
	const m = raw as RawMerge | undefined;
	const strategy = m?.strategy ?? "concat";
	return mergeFromStrategy(
		strategy as "concat" | "awaitAll" | "firstPass" | "vote" | "rank",
	);
}

// ── Runnable deserialization ──────────────────────────────────────────────

function deserializeStep(s: Step): Step {
	return {
		...s,
		gate: deserializeGate(s.gate),
		onFail: deserializeOnFail(s.onFail),
		transform: deserializeTransform(s.transform),
	};
}

/** Recursively walk a Runnable tree, converting JSON gate/onFail objects to functions */
export function deserializeRunnable(r: Runnable): Runnable {
	switch (r.kind) {
		case "step":
			return deserializeStep(r);

		case "sequential":
			return {
				...r,
				gate: deserializeGate(r.gate),
				onFail: deserializeOnFail(r.onFail),
				transform: r.transform ? deserializeTransform(r.transform) : undefined,
				steps: r.steps.map(deserializeRunnable),
			};

		case "pool":
			return {
				...r,
				gate: deserializeGate(r.gate),
				onFail: deserializeOnFail(r.onFail),
				transform: r.transform ? deserializeTransform(r.transform) : undefined,
				merge: deserializeMerge(r.merge),
				step: deserializeRunnable(r.step),
			};

		case "parallel":
			return {
				...r,
				gate: deserializeGate(r.gate),
				onFail: deserializeOnFail(r.onFail),
				transform: r.transform ? deserializeTransform(r.transform) : undefined,
				merge: deserializeMerge(r.merge),
				steps: r.steps.map(deserializeRunnable),
			};

		default:
			return r;
	}
}
