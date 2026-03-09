// ── select.ts Unit Tests ───────────────────────────────────────────────────
// Tests for buildPipelineSelectOptions and parsePipelineSelectOption helpers.
// These tests MUST FAIL until extensions/captain/ui/select.ts is created.

import { describe, expect, test } from "bun:test";
import type { CaptainState } from "../state.js";
import {
	buildPipelineSelectOptions,
	parsePipelineSelectOption,
} from "./select.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a minimal CaptainState-like object for testing.
 * We only need the subset of the class used by buildPipelineSelectOptions.
 */
function makeState({
	loadedNames = [] as string[],
	builtinNames = [] as string[],
} = {}): CaptainState {
	const pipelines: Record<string, { spec: unknown }> = {};
	for (const name of loadedNames) {
		pipelines[name] = { spec: { kind: "step" } as unknown };
	}

	const builtinPresetMap: Record<string, { pipeline: unknown }> = {};
	for (const name of builtinNames) {
		builtinPresetMap[name] = { pipeline: { kind: "step" } as unknown };
	}

	return {
		pipelines,
		builtinPresetMap,
	} as unknown as CaptainState;
}

// ── buildPipelineSelectOptions ─────────────────────────────────────────────

describe("buildPipelineSelectOptions", () => {
	test("returns empty array when state has no loaded pipelines and no builtin presets", () => {
		const state = makeState();
		const options = buildPipelineSelectOptions(state);
		expect(options).toEqual([]);
	});

	test("returns loaded pipelines labeled with (loaded)", () => {
		const state = makeState({ loadedNames: ["my-pipe"] });
		const options = buildPipelineSelectOptions(state);
		expect(options).toContain("my-pipe (loaded)");
	});

	test("returns multiple loaded pipelines all labeled (loaded)", () => {
		const state = makeState({ loadedNames: ["pipe-a", "pipe-b"] });
		const options = buildPipelineSelectOptions(state);
		expect(options).toContain("pipe-a (loaded)");
		expect(options).toContain("pipe-b (loaded)");
	});

	test("returns only builtin presets labeled (builtin) when nothing is loaded", () => {
		const state = makeState({ builtinNames: ["captain:foo", "captain:bar"] });
		const options = buildPipelineSelectOptions(state);
		expect(options).toContain("captain:foo (builtin)");
		expect(options).toContain("captain:bar (builtin)");
		expect(options.some((o) => o.includes("(loaded)"))).toBe(false);
	});

	test("puts loaded pipelines BEFORE unloaded builtin presets", () => {
		const state = makeState({
			loadedNames: ["a", "b"],
			builtinNames: ["captain:foo"],
		});
		const options = buildPipelineSelectOptions(state);

		// All (loaded) entries must appear before (builtin) entries
		const firstBuiltinIdx = options.findIndex((o) => o.endsWith("(builtin)"));
		const lastLoadedIdx = options.reduce(
			(acc, o, i) => (o.endsWith("(loaded)") ? i : acc),
			-1,
		);

		expect(firstBuiltinIdx).toBeGreaterThan(lastLoadedIdx);
	});

	test("exact ordering: loaded names first, then unloaded presets", () => {
		const state = makeState({
			loadedNames: ["a", "b"],
			builtinNames: ["captain:foo"],
		});
		const options = buildPipelineSelectOptions(state);
		// The first N entries should be (loaded), last M entries should be (builtin)
		const loadedOpts = options.filter((o) => o.endsWith("(loaded)"));
		const builtinOpts = options.filter((o) => o.endsWith("(builtin)"));
		expect(loadedOpts).toHaveLength(2);
		expect(builtinOpts).toHaveLength(1);
		// Loaded appear before builtins in the array
		const firstBuiltinPos = options.indexOf(builtinOpts[0]);
		for (const lo of loadedOpts) {
			expect(options.indexOf(lo)).toBeLessThan(firstBuiltinPos);
		}
	});

	test("does NOT add builtin as (builtin) if it is already loaded", () => {
		// "captain:foo" is both in loaded pipelines and in builtinPresetMap
		const state = makeState({
			loadedNames: ["captain:foo"],
			builtinNames: ["captain:foo", "captain:bar"],
		});
		const options = buildPipelineSelectOptions(state);

		// "captain:foo" should appear ONCE as (loaded), not as (builtin)
		const fooEntries = options.filter((o) => o.startsWith("captain:foo"));
		expect(fooEntries).toHaveLength(1);
		expect(fooEntries[0]).toBe("captain:foo (loaded)");

		// "captain:bar" appears as (builtin) since it is not loaded
		expect(options).toContain("captain:bar (builtin)");
	});

	test("returns only (loaded) when all presets are already loaded", () => {
		const state = makeState({
			loadedNames: ["captain:spec-tdd"],
			builtinNames: ["captain:spec-tdd"],
		});
		const options = buildPipelineSelectOptions(state);
		expect(options).toEqual(["captain:spec-tdd (loaded)"]);
	});

	test("returns correct options for 2 loaded + 1 unloaded preset scenario from spec", () => {
		const state = makeState({
			loadedNames: ["a", "b"],
			builtinNames: ["captain:foo"],
		});
		const options = buildPipelineSelectOptions(state);
		expect(options).toContain("a (loaded)");
		expect(options).toContain("b (loaded)");
		expect(options).toContain("captain:foo (builtin)");
		expect(options).toHaveLength(3);
	});

	test("works with pipeline name containing parentheses-like chars in the middle", () => {
		// Edge case: name contains " (" but parse should still work
		const state = makeState({ loadedNames: ["my(special)pipe"] });
		const options = buildPipelineSelectOptions(state);
		expect(options).toContain("my(special)pipe (loaded)");
	});
});

// ── parsePipelineSelectOption ──────────────────────────────────────────────

describe("parsePipelineSelectOption", () => {
	test('strips " (loaded)" suffix', () => {
		expect(parsePipelineSelectOption("my-pipe (loaded)")).toBe("my-pipe");
	});

	test('strips " (builtin)" suffix', () => {
		expect(parsePipelineSelectOption("captain:spec-tdd (builtin)")).toBe(
			"captain:spec-tdd",
		);
	});

	test("handles pipeline name with spaces before the suffix", () => {
		expect(parsePipelineSelectOption("name with spaces (loaded)")).toBe(
			"name with spaces",
		);
	});

	test("returns the string unchanged when no suffix is present (graceful fallback)", () => {
		expect(parsePipelineSelectOption("plain-name")).toBe("plain-name");
	});

	test('returns correct name for "foo-bar (loaded)"', () => {
		expect(parsePipelineSelectOption("foo-bar (loaded)")).toBe("foo-bar");
	});

	test('returns correct name for "captain:spec-tdd (builtin)"', () => {
		expect(parsePipelineSelectOption("captain:spec-tdd (builtin)")).toBe(
			"captain:spec-tdd",
		);
	});

	test("handles pipeline name that itself contains ' (' in the middle", () => {
		// The suffix is anchored to the end: /\s+\((loaded|builtin)\)$/
		// So "weird (name) (loaded)" should return "weird (name)"
		expect(parsePipelineSelectOption("weird (name) (loaded)")).toBe(
			"weird (name)",
		);
	});

	test("handles empty string input gracefully", () => {
		// Should not throw; return "" or the input unchanged
		const result = parsePipelineSelectOption("");
		expect(typeof result).toBe("string");
	});
});
