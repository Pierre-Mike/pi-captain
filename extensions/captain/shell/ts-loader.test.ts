import { describe, expect, test } from "bun:test";
import type { Runnable } from "../core/types.js";
import { extractPipeline, resolveAliases } from "./ts-loader.js";

describe("resolveAliases", () => {
	test('replaces "<captain>/" bracket-style alias', () => {
		const raw = 'import { retry } from "<captain>/gates/on-fail.js";';
		const result = resolveAliases(raw, "/abs/captain");
		expect(result).toBe(
			'import { retry } from "/abs/captain/gates/on-fail.js";',
		);
	});

	test('replaces "captain/" no-bracket-style alias', () => {
		const raw = 'import { full } from "captain/transforms/presets.js";';
		const result = resolveAliases(raw, "/abs/captain");
		expect(result).toBe(
			'import { full } from "/abs/captain/transforms/presets.js";',
		);
	});

	test("replaces multiple occurrences", () => {
		const raw = [
			'import a from "<captain>/a.js";',
			'import b from "<captain>/b.js";',
		].join("\n");
		const result = resolveAliases(raw, "/dir");
		expect(result).toContain('from "/dir/a.js"');
		expect(result).toContain('from "/dir/b.js"');
	});

	test("leaves non-alias imports unchanged", () => {
		const raw = 'import { foo } from "some-package";';
		expect(resolveAliases(raw, "/dir")).toBe(raw);
	});

	test("returns empty string unchanged", () => {
		expect(resolveAliases("", "/dir")).toBe("");
	});

	test("uses the captainDir verbatim in replacement", () => {
		const result = resolveAliases('"<captain>/x.js"', "/my/captain/dir");
		expect(result).toContain("/my/captain/dir/");
	});
});

describe("extractPipeline", () => {
	test("returns pipeline from top-level export", () => {
		const pipeline = { kind: "step", label: "a", prompt: "b" } as Runnable;
		const mod = { pipeline };
		expect(extractPipeline(mod)).toBe(pipeline);
	});

	test("returns pipeline from default.pipeline", () => {
		const pipeline = { kind: "sequential", steps: [] } as unknown as Runnable;
		const mod = { default: { pipeline } };
		expect(extractPipeline(mod)).toBe(pipeline);
	});

	test("returns undefined when no pipeline export", () => {
		expect(extractPipeline({ other: "value" })).toBeUndefined();
	});

	test("returns undefined when pipeline has no kind", () => {
		const mod = { pipeline: { label: "x" } };
		expect(extractPipeline(mod)).toBeUndefined();
	});

	test("top-level pipeline takes priority over default.pipeline", () => {
		const direct = { kind: "step", label: "direct", prompt: "" } as Runnable;
		const nested = { kind: "step", label: "nested", prompt: "" } as Runnable;
		const mod = { pipeline: direct, default: { pipeline: nested } };
		expect(extractPipeline(mod)).toBe(direct);
	});

	test("returns undefined for empty module", () => {
		expect(extractPipeline({})).toBeUndefined();
	});
});
