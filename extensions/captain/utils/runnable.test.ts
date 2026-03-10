import { describe, expect, test } from "bun:test";
import { full } from "../transforms/presets.js";
import type { Parallel, Pool, Runnable, Sequential, Step } from "../types.js";
import {
	collectAgentRefs,
	collectStepLabels,
	containerGateInfo,
	describeRunnable,
	findStepByLabel,
	statusIcon,
} from "./runnable.js";

// ── Fixtures ──────────────────────────────────────────────────────────────

const step = (label: string): Step => ({
	kind: "step",
	label,
	prompt: "do something",
	transform: full,
});

const seq = (...steps: Runnable[]): Sequential => ({
	kind: "sequential",
	steps,
});

const pool = (inner: Runnable, count = 3): Pool => ({
	kind: "pool",
	step: inner,
	count,
	merge: { strategy: "concat" },
});

const par = (...steps: Runnable[]): Parallel => ({
	kind: "parallel",
	steps,
	merge: { strategy: "concat" },
});

// ── collectAgentRefs ──────────────────────────────────────────────────────

describe("collectAgentRefs", () => {
	test("step returns its label", () => {
		expect(collectAgentRefs(step("s1"))).toEqual(["s1"]);
	});

	test("sequential collects from all steps", () => {
		const r = seq(step("a"), step("b"), step("c"));
		expect(collectAgentRefs(r)).toEqual(["a", "b", "c"]);
	});

	test("pool collects from inner step", () => {
		expect(collectAgentRefs(pool(step("s")))).toEqual(["s"]);
	});

	test("parallel collects from all branches", () => {
		const r = par(step("a"), step("b"));
		expect(collectAgentRefs(r)).toEqual(["a", "b"]);
	});

	test("nested structure collects recursively", () => {
		const r = seq(par(step("a"), seq(step("b"))));
		expect(collectAgentRefs(r)).toEqual(["a", "b"]);
	});
});

// ── collectStepLabels ─────────────────────────────────────────────────────

describe("collectStepLabels", () => {
	test("step returns its own label", () => {
		expect(collectStepLabels(step("my-step"))).toEqual(["my-step"]);
	});

	test("sequential returns all step labels", () => {
		expect(collectStepLabels(seq(step("a"), step("b"), step("c")))).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	test("pool returns inner step label", () => {
		expect(collectStepLabels(pool(step("pooled")))).toEqual(["pooled"]);
	});

	test("parallel returns all branch labels", () => {
		expect(collectStepLabels(par(step("x"), step("y")))).toEqual(["x", "y"]);
	});

	test("nested sequential flattens all labels", () => {
		const r = seq(step("a"), par(step("b"), step("c")), step("d"));
		expect(collectStepLabels(r)).toEqual(["a", "b", "c", "d"]);
	});
});

// ── findStepByLabel ───────────────────────────────────────────────────────

describe("findStepByLabel", () => {
	test("finds exact label match in step", () => {
		const s = step("my-step");
		expect(findStepByLabel(s, "my-step")).toBe(s);
	});

	test("case-insensitive substring match", () => {
		const s = step("Analyze Codebase");
		expect(findStepByLabel(s, "analyze")).toBe(s);
		expect(findStepByLabel(s, "CODEBASE")).toBe(s);
	});

	test("returns undefined when not found", () => {
		expect(findStepByLabel(step("hello"), "world")).toBeUndefined();
	});

	test("finds step nested in sequential", () => {
		const inner = step("target-step");
		const r = seq(step("other"), inner);
		expect(findStepByLabel(r, "target")).toBe(inner);
	});

	test("finds step nested in parallel", () => {
		const inner = step("deep-step");
		const r = par(step("a"), inner);
		expect(findStepByLabel(r, "deep")).toBe(inner);
	});

	test("finds step nested in pool", () => {
		const inner = step("pool-inner");
		expect(findStepByLabel(pool(inner), "pool-inner")).toBe(inner);
	});

	test("returns first match in sequential", () => {
		const first = step("analyze-first");
		const second = step("analyze-second");
		const r = seq(first, second);
		expect(findStepByLabel(r, "analyze")).toBe(first);
	});
});

// ── statusIcon ────────────────────────────────────────────────────────────

describe("statusIcon", () => {
	test("passed → ✓", () => expect(statusIcon("passed")).toBe("✓"));
	test("failed → ✗", () => expect(statusIcon("failed")).toBe("✗"));
	test("skipped → ⊘", () => expect(statusIcon("skipped")).toBe("⊘"));
	test("running → ⏳", () => expect(statusIcon("running")).toBe("⏳"));
	test("unknown → ○", () => expect(statusIcon("unknown")).toBe("○"));
});

// ── containerGateInfo ─────────────────────────────────────────────────────

describe("containerGateInfo", () => {
	test("no gate returns empty string", () => {
		expect(containerGateInfo(undefined, undefined)).toBe("");
	});

	test("gate without onFail shows onFail: none", () => {
		function myCommandGate(): true {
			return true;
		}
		const result = containerGateInfo(myCommandGate, undefined);
		expect(result).toContain("gate: myCommandGate");
		expect(result).toContain("onFail: none");
	});

	test("gate with onFail shows both", () => {
		function myLlmGate(): true {
			return true;
		}
		function myOnFail() {
			return { action: "retry" as const };
		}
		const result = containerGateInfo(myLlmGate, myOnFail);
		expect(result).toContain("gate: myLlmGate");
		expect(result).toContain("onFail: fn");
	});
});

// ── describeRunnable ──────────────────────────────────────────────────────

describe("describeRunnable", () => {
	test("step shows label, gate, onFail", () => {
		const r = step("my-step");
		const desc = describeRunnable(r, 0);
		expect(desc).toContain("[step]");
		expect(desc).toContain("my-step");
		// no gate or onFail on this step — they're optional now
	});

	test("step shows model and tools", () => {
		const desc = describeRunnable(step("s"), 0);
		expect(desc).toContain("model: default");
		expect(desc).toContain("tools:");
	});

	test("sequential shows step count and children", () => {
		const desc = describeRunnable(seq(step("a"), step("b")), 0);
		expect(desc).toContain("[sequential]");
		expect(desc).toContain("2 steps");
		expect(desc).toContain('"a"');
		expect(desc).toContain('"b"');
	});

	test("pool shows count and merge strategy", () => {
		const desc = describeRunnable(pool(step("worker"), 5), 0);
		expect(desc).toContain("[pool]");
		expect(desc).toContain("×5");
		expect(desc).toContain("merge: concat");
	});

	test("parallel shows branch count", () => {
		const desc = describeRunnable(par(step("a"), step("b"), step("c")), 0);
		expect(desc).toContain("[parallel]");
		expect(desc).toContain("3 branches");
	});

	test("indentation is applied", () => {
		const desc = describeRunnable(step("s"), 4);
		expect(desc.startsWith("    ")).toBe(true);
	});
});
