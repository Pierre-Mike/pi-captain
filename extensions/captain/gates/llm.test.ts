import { describe, expect, test } from "bun:test";
import { buildPrompt, MAX_OUTPUT, parseJudgment } from "./llm.js";

describe("buildPrompt", () => {
	test("contains the criteria", () => {
		const p = buildPrompt("output must be valid JSON", "some output");
		expect(p).toContain("output must be valid JSON");
	});

	test("contains the output", () => {
		const p = buildPrompt("criteria", "my step output");
		expect(p).toContain("my step output");
	});

	test("replaces $OUTPUT placeholder in criteria with the truncated output", () => {
		const p = buildPrompt("check: $OUTPUT", "hello");
		expect(p).toContain("check: hello");
	});

	test("truncates output to MAX_OUTPUT characters", () => {
		const long = "x".repeat(MAX_OUTPUT + 500);
		const p = buildPrompt("criteria", long);
		// The truncated output appears in the prompt — not the full string
		expect(p).not.toContain("x".repeat(MAX_OUTPUT + 1));
		expect(p).toContain("x".repeat(MAX_OUTPUT));
	});

	test("contains the JSON instructions", () => {
		const p = buildPrompt("criteria", "output");
		expect(p).toContain('"pass"');
		expect(p).toContain('"confidence"');
		expect(p).toContain('"reason"');
	});

	test("returns a non-empty string", () => {
		expect(buildPrompt("c", "o").length).toBeGreaterThan(0);
	});
});

describe("parseJudgment", () => {
	test("parses a valid JSON pass response", () => {
		const j = parseJudgment(
			'{ "pass": true, "confidence": 0.9, "reason": "looks good" }',
		);
		expect(j.pass).toBe(true);
		expect(j.confidence).toBe(0.9);
		expect(j.reason).toBe("looks good");
	});

	test("parses a valid JSON fail response", () => {
		const j = parseJudgment(
			'{ "pass": false, "confidence": 0.3, "reason": "too short" }',
		);
		expect(j.pass).toBe(false);
		expect(j.confidence).toBe(0.3);
		expect(j.reason).toBe("too short");
	});

	test("parses JSON wrapped in a code fence", () => {
		const j = parseJudgment(
			'```json\n{ "pass": true, "confidence": 0.8, "reason": "ok" }\n```',
		);
		expect(j.pass).toBe(true);
		expect(j.confidence).toBe(0.8);
	});

	test("clamps confidence to [0, 1]", () => {
		const high = parseJudgment(
			'{ "pass": true, "confidence": 5.0, "reason": "" }',
		);
		expect(high.confidence).toBe(1);

		const low = parseJudgment(
			'{ "pass": true, "confidence": -1, "reason": "" }',
		);
		expect(low.confidence).toBe(0);
	});

	test("defaults confidence to 0.5 when missing", () => {
		const j = parseJudgment('{ "pass": true, "reason": "fine" }');
		expect(j.confidence).toBe(0.5);
	});

	test("defaults reason to 'No reason given' when missing", () => {
		const j = parseJudgment('{ "pass": true, "confidence": 0.9 }');
		expect(j.reason).toBe("No reason given");
	});

	test("falls back to text heuristic when JSON is invalid — pass", () => {
		const j = parseJudgment("this output looks good, it passes all checks");
		expect(j.pass).toBe(true);
		expect(j.confidence).toBe(0.5);
	});

	test("falls back to text heuristic when JSON is invalid — fail", () => {
		const j = parseJudgment("this output fails the requirement");
		expect(j.pass).toBe(false);
	});

	test("fallback reason contains part of the raw text", () => {
		const j = parseJudgment("not valid json at all");
		expect(j.reason).toContain("Could not parse");
	});
});
