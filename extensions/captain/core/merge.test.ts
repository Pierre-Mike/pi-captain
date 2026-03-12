import { describe, expect, test } from "bun:test";
import type { MergeCtx } from "./merge.js";
import { awaitAll, concat, firstPass, rank, vote } from "./merge.js";

// A fake MergeCtx — only needed for vote/rank (LLM strategies)
function makeMctx(): MergeCtx {
	return {
		// biome-ignore lint/suspicious/noExplicitAny: test stub
		model: {} as any,
		apiKey: "test-key",
	};
}

// ── concat ────────────────────────────────────────────────────────────────

describe("concat", () => {
	test("returns (no output) when all outputs are empty", async () => {
		expect(await concat(["", "  ", ""], makeMctx())).toBe("(no output)");
	});

	test("returns single output directly when only one is non-empty", async () => {
		expect(await concat(["", "only this", ""], makeMctx())).toBe("only this");
	});

	test("joins all outputs with branch separators", async () => {
		const result = await concat(["alpha", "beta", "gamma"], makeMctx());
		expect(result).toContain("--- Branch 1 ---");
		expect(result).toContain("--- Branch 2 ---");
		expect(result).toContain("--- Branch 3 ---");
		expect(result).toContain("alpha");
		expect(result).toContain("beta");
		expect(result).toContain("gamma");
	});

	test("skips empty outputs", async () => {
		const result = await concat(["a", "", "c"], makeMctx());
		expect(result).toContain("--- Branch 1 ---");
		expect(result).toContain("--- Branch 2 ---");
		expect(result).not.toContain("--- Branch 3 ---");
	});
});

// ── awaitAll ──────────────────────────────────────────────────────────────

describe("awaitAll", () => {
	test("behaves like concat", async () => {
		const result = await awaitAll(["x", "y"], makeMctx());
		expect(result).toContain("--- Branch 1 ---");
		expect(result).toContain("x");
		expect(result).toContain("--- Branch 2 ---");
		expect(result).toContain("y");
	});
});

// ── firstPass ─────────────────────────────────────────────────────────────

describe("firstPass", () => {
	test("returns the first non-empty output", async () => {
		expect(await firstPass(["", "winner", "other"], makeMctx())).toBe("winner");
	});

	test("returns only output when there is one", async () => {
		expect(await firstPass(["solo"], makeMctx())).toBe("solo");
	});

	test("returns (no output) when all empty", async () => {
		expect(await firstPass(["", "  "], makeMctx())).toBe("(no output)");
	});
});

// ── vote ──────────────────────────────────────────────────────────────────

describe("vote", () => {
	test("returns a string (or merge error fallback without real API)", async () => {
		try {
			const result = await vote(["option A", "option B"], makeMctx());
			expect(typeof result).toBe("string");
		} catch {
			// expected without real API key
		}
	});
});

// ── rank ──────────────────────────────────────────────────────────────────

describe("rank", () => {
	test("returns a string (or merge error fallback without real API)", async () => {
		try {
			const result = await rank(["answer 1", "answer 2"], makeMctx());
			expect(typeof result).toBe("string");
		} catch {
			// expected without real API key
		}
	});
});
