import { describe, expect, mock, test } from "bun:test";
import type { GateCtx } from "../types.js";
import {
	allOf,
	bunTest,
	command,
	file,
	llmFast,
	regexCI,
	runGate,
	user,
} from "./index.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeExec(code = 0, stdout = "", stderr = "") {
	return mock(
		async (_cmd: string, _args: readonly string[], _opts?: unknown) => ({
			code,
			stdout,
			stderr,
		}),
	);
}

function ctx(overrides: Partial<GateCtx> = {}): GateCtx {
	return {
		exec: makeExec(),
		hasUI: false,
		cwd: "/tmp",
		...overrides,
	};
}

// ── runGate ───────────────────────────────────────────────────────────────

describe("gate: runGate", () => {
	test("returns passed:true when gate returns true", async () => {
		const result = await runGate(() => true, "");
		expect(result.passed).toBe(true);
		expect(result.reason).toBe("passed");
	});

	test("returns passed:false with string reason when gate returns a string", async () => {
		const result = await runGate(() => "it was empty", "");
		expect(result.passed).toBe(false);
		expect(result.reason).toBe("it was empty");
	});

	test("catches throw — gate errors become failed results", async () => {
		const result = await runGate(() => {
			throw new Error("boom");
		}, "");
		expect(result.passed).toBe(false);
		expect(result.reason).toBe("boom");
	});
});

// ── command ───────────────────────────────────────────────────────────────

describe("gate: command", () => {
	test("passes when command exits 0", async () => {
		const result = await runGate(
			command("exit 0"),
			"",
			ctx({ exec: makeExec(0, "ok") }),
		);
		expect(result.passed).toBe(true);
	});

	test("fails with reason when command exits non-zero", async () => {
		const result = await runGate(
			command("exit 1"),
			"",
			ctx({ exec: makeExec(1, "", "something went wrong") }),
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("Command failed");
		expect(result.reason).toContain("something went wrong");
	});

	test("fails with reason when no ctx provided", async () => {
		const result = await runGate(command("exit 0"), "");
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("requires execution context");
	});
});

// ── file ──────────────────────────────────────────────────────────────────

describe("gate: file", () => {
	test("passes when file exists", async () => {
		const result = await runGate(
			file("/some/file.txt"),
			"",
			ctx({ exec: makeExec(0) }),
		);
		expect(result.passed).toBe(true);
	});

	test("fails with path in reason when file missing", async () => {
		const result = await runGate(
			file("/missing.txt"),
			"",
			ctx({ exec: makeExec(1) }),
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("/missing.txt");
	});
});

// ── regexCI ───────────────────────────────────────────────────────────────

describe("gate: regexCI", () => {
	test("passes when pattern matches (case-insensitive)", async () => {
		const result = await runGate(regexCI("hello"), "HELLO WORLD");
		expect(result.passed).toBe(true);
	});

	test("fails with pattern in reason when no match", async () => {
		const result = await runGate(regexCI("error"), "all good");
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("error");
	});
});

// ── user ──────────────────────────────────────────────────────────────────

describe("gate: user", () => {
	test("fails with reason when no UI available", async () => {
		const result = await runGate(user, "", ctx({ hasUI: false }));
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("requires interactive UI");
	});

	test("passes when user confirms", async () => {
		const result = await runGate(
			user,
			"output",
			ctx({ hasUI: true, confirm: async () => true }),
		);
		expect(result.passed).toBe(true);
	});

	test("fails with reason when user rejects", async () => {
		const result = await runGate(
			user,
			"output",
			ctx({ hasUI: true, confirm: async () => false }),
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toBe("User rejected");
	});
});

// ── allOf ─────────────────────────────────────────────────────────────────

describe("gate: allOf", () => {
	test("passes when all gates pass", async () => {
		const result = await runGate(
			allOf(
				() => true,
				() => true,
			),
			"ok",
		);
		expect(result.passed).toBe(true);
	});

	test("fails with first failure reason", async () => {
		const result = await runGate(
			allOf(
				() => true,
				() => "second failed",
			),
			"ok",
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toBe("second failed");
	});
});

// ── inline gate ───────────────────────────────────────────────────────────

describe("gate: inline", () => {
	test("returning true passes", async () => {
		const result = await runGate(
			({ output }) => (output.length > 5 ? true : "too short"),
			"hello world",
		);
		expect(result.passed).toBe(true);
	});

	test("returning string fails with that reason", async () => {
		const result = await runGate(
			({ output }) => (output.length > 5 ? true : "too short"),
			"hi",
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toBe("too short");
	});
});

// ── bunTest ───────────────────────────────────────────────────────────────

describe("gate: bunTest", () => {
	test("passes when bun test exits 0", async () => {
		const result = await runGate(bunTest, "", ctx({ exec: makeExec(0) }));
		expect(result.passed).toBe(true);
	});

	test("fails with reason when bun test exits non-zero", async () => {
		const result = await runGate(
			bunTest,
			"",
			ctx({ exec: makeExec(1, "", "3 tests failed") }),
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("Command failed");
	});
});

// ── llmFast ───────────────────────────────────────────────────────────────

describe("gate: llmFast", () => {
	test("fails with reason when model/apiKey not in context", async () => {
		const result = await runGate(
			llmFast("Does this look good?"),
			"some output",
		);
		expect(result.passed).toBe(false);
		expect(result.reason).toContain("requires model and apiKey");
	});
});
