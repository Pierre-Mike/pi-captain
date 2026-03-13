import { describe, expect, test } from "bun:test";
import type { Runnable } from "../core/types.js";
import type { CaptainState } from "../state.js";
import {
	buildAdHocStep,
	ensurePipelineLoaded,
	parseInlineFlags,
	parsePipelineAndInput,
	parseStepFlag,
} from "./commands-parse.js";

// ── Mock state helpers ────────────────────────────────────────────────────

function makeState(
	pipelines: Record<string, { spec: Runnable }> = {},
	resolveResult?: { name: string; spec: Runnable } | undefined,
	resolveThrows?: Error,
): CaptainState {
	return {
		pipelines,
		resolvePreset: resolveThrows
			? () => {
					throw resolveThrows;
				}
			: () => Promise.resolve(resolveResult),
	} as unknown as CaptainState;
}

// ── parseStepFlag ─────────────────────────────────────────────────────────

describe("parseStepFlag", () => {
	test("extracts step filter and removes it from args", () => {
		const { stepFilter, cleanedArgs } = parseStepFlag(
			"run --step Research input text",
		);
		expect(stepFilter).toBe("Research");
		expect(cleanedArgs).toBe("run input text");
	});

	test("returns undefined stepFilter when flag absent", () => {
		const { stepFilter, cleanedArgs } = parseStepFlag("run some input");
		expect(stepFilter).toBeUndefined();
		expect(cleanedArgs).toBe("run some input");
	});

	test("handles --step at end of string", () => {
		const { stepFilter } = parseStepFlag("run --step MyStep");
		expect(stepFilter).toBe("MyStep");
	});

	test("handles empty string", () => {
		const { stepFilter, cleanedArgs } = parseStepFlag("");
		expect(stepFilter).toBeUndefined();
		expect(cleanedArgs).toBe("");
	});
});

// ── parseInlineFlags ──────────────────────────────────────────────────────

describe("parseInlineFlags", () => {
	test("parses single flag", () => {
		const { flags, prompt } = parseInlineFlags("do the thing --model flash");
		expect(flags.model).toBe("flash");
		expect(prompt).toContain("do the thing");
	});

	test("parses multiple flags", () => {
		const { flags } = parseInlineFlags(
			"prompt text --model sonnet --label MyStep",
		);
		expect(flags.model).toBe("sonnet");
		expect(flags.label).toBe("MyStep");
	});

	test("returns empty flags and full string when no flags present", () => {
		const { flags, prompt } = parseInlineFlags("just a prompt");
		expect(flags).toEqual({});
		expect(prompt).toBe("just a prompt");
	});

	test("returns empty flags for empty input", () => {
		const { flags, prompt } = parseInlineFlags("");
		expect(flags).toEqual({});
		expect(prompt).toBe("");
	});
});

// ── buildAdHocStep ────────────────────────────────────────────────────────

describe("buildAdHocStep", () => {
	test("builds step with default label and tools", () => {
		const s = buildAdHocStep("do something", {});
		expect(s.kind).toBe("step");
		expect(s.label).toBe("ad-hoc step");
		expect(s.prompt).toBe("do something");
		expect(s.tools).toEqual(["read", "bash", "edit", "write"]);
	});

	test("uses label flag when provided", () => {
		const s = buildAdHocStep("prompt", { label: "Custom Label" });
		expect(s.label).toBe("Custom Label");
	});

	test("uses model flag when provided", () => {
		const s = buildAdHocStep("prompt", { model: "flash" });
		expect(s.model).toBe("flash");
	});

	test("splits tools flag on comma", () => {
		const s = buildAdHocStep("prompt", { tools: "read,bash" });
		expect(s.tools).toEqual(["read", "bash"]);
	});

	test("step has skip onFail and full transform", () => {
		const s = buildAdHocStep("p", {});
		expect(typeof s.onFail).toBe("function");
		expect(typeof s.transform).toBe("function");
		expect(s.gate).toBeUndefined();
	});
});

// ── ensurePipelineLoaded ──────────────────────────────────────────────────

describe("ensurePipelineLoaded", () => {
	test("returns the name immediately when pipeline already in state", async () => {
		const spec: Runnable = { kind: "step", label: "x", prompt: "y" };
		const state = makeState({ "my-pipe": { spec } });
		const msgs: string[] = [];
		const result = await ensurePipelineLoaded("my-pipe", "/cwd", state, (m) =>
			msgs.push(m),
		);
		expect(result).toBe("my-pipe");
		expect(msgs).toHaveLength(0);
	});

	test("loads and returns resolved name when resolvePreset succeeds", async () => {
		const spec: Runnable = { kind: "step", label: "x", prompt: "y" };
		const state = makeState({}, { name: "my-pipe", spec });
		const msgs: string[] = [];
		const result = await ensurePipelineLoaded("my-pipe", "/cwd", state, (m) =>
			msgs.push(m),
		);
		expect(result).toBe("my-pipe");
		expect(msgs[0]).toContain("Auto-loaded");
	});

	test("returns undefined and notifies when resolvePreset returns undefined", async () => {
		const state = makeState({}, undefined);
		const errors: string[] = [];
		const result = await ensurePipelineLoaded(
			"missing",
			"/cwd",
			state,
			(m, lvl) => {
				if (lvl === "error") errors.push(m);
			},
		);
		expect(result).toBeUndefined();
		expect(errors[0]).toContain("missing");
	});

	test("returns undefined and notifies when resolvePreset throws", async () => {
		const state = makeState({}, undefined, new Error("disk error"));
		const errors: string[] = [];
		const result = await ensurePipelineLoaded(
			"broken",
			"/cwd",
			state,
			(m, lvl) => {
				if (lvl === "error") errors.push(m);
			},
		);
		expect(result).toBeUndefined();
		expect(errors[0]).toContain("disk error");
	});
});

// ── parsePipelineAndInput ─────────────────────────────────────────────────

describe("parsePipelineAndInput", () => {
	test("splits bare tokens into pipeline and input", () => {
		const { pipeline, input } = parsePipelineAndInput("my-preset do the thing");
		expect(pipeline).toBe("my-preset");
		expect(input).toBe("do the thing");
	});

	test("handles single-quoted tokens", () => {
		const { pipeline, input } = parsePipelineAndInput(
			"'./pipe.ts' 'hello world'",
		);
		expect(pipeline).toBe("./pipe.ts");
		expect(input).toBe("hello world");
	});

	test("handles double-quoted tokens", () => {
		const { pipeline, input } = parsePipelineAndInput('"my preset" "run it"');
		expect(pipeline).toBe("my preset");
		expect(input).toBe("run it");
	});

	test("returns empty input when only pipeline given", () => {
		const { pipeline, input } = parsePipelineAndInput("my-preset");
		expect(pipeline).toBe("my-preset");
		expect(input).toBe("");
	});

	test("returns empty pipeline and input for empty string", () => {
		const { pipeline, input } = parsePipelineAndInput("");
		expect(pipeline).toBe("");
		expect(input).toBe("");
	});
});
