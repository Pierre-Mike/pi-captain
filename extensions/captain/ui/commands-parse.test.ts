import { describe, expect, test } from "bun:test";
import type { Runnable } from "../core/types.js";
import type { CaptainState } from "../state.js";
import {
	buildAdHocStep,
	ensurePipelineLoaded,
	parseCaptainRunArgs,
	parseInlineFlags,
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
	test("returns true immediately when pipeline already in state", async () => {
		const spec: Runnable = { kind: "step", label: "x", prompt: "y" };
		const state = makeState({ "my-pipe": { spec } });
		const msgs: string[] = [];
		const result = await ensurePipelineLoaded("my-pipe", "/cwd", state, (m) =>
			msgs.push(m),
		);
		expect(result).toBe(true);
		expect(msgs).toHaveLength(0);
	});

	test("loads and returns true when resolvePreset succeeds", async () => {
		const spec: Runnable = { kind: "step", label: "x", prompt: "y" };
		const state = makeState({}, { name: "my-pipe", spec });
		const msgs: string[] = [];
		const result = await ensurePipelineLoaded("my-pipe", "/cwd", state, (m) =>
			msgs.push(m),
		);
		expect(result).toBe(true);
		expect(msgs[0]).toContain("Auto-loaded");
	});

	test("returns false and notifies when resolvePreset returns undefined", async () => {
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
		expect(result).toBe(false);
		expect(errors[0]).toContain("missing");
	});

	test("returns false and notifies when resolvePreset throws", async () => {
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
		expect(result).toBe(false);
		expect(errors[0]).toContain("disk error");
	});
});

// ── parseCaptainRunArgs ───────────────────────────────────────────────────

describe("parseCaptainRunArgs", () => {
	const step: Runnable = { kind: "step", label: "Research", prompt: "do it" };

	test("returns null and notifies when name is missing", async () => {
		const state = makeState();
		const errors: string[] = [];
		const result = await parseCaptainRunArgs("", state, "/cwd", (m, lvl) => {
			if (lvl === "error") errors.push(m);
		});
		expect(result).toBeNull();
		expect(errors[0]).toContain("Usage");
	});

	test("returns null and notifies when input is missing", async () => {
		const state = makeState({ "my-pipe": { spec: step } });
		const errors: string[] = [];
		const result = await parseCaptainRunArgs(
			"my-pipe",
			state,
			"/cwd",
			(m, lvl) => {
				if (lvl === "error") errors.push(m);
			},
		);
		expect(result).toBeNull();
		expect(errors[0]).toContain("Usage");
	});

	test("returns parsed result for valid name and input", async () => {
		const state = makeState({ "my-pipe": { spec: step } });
		const result = await parseCaptainRunArgs(
			"my-pipe hello world",
			state,
			"/cwd",
			() => {
				/* noop */
			},
		);
		expect(result).not.toBeNull();
		expect(result?.name).toBe("my-pipe");
		expect(result?.input).toBe("hello world");
		expect(result?.stepFilter).toBeUndefined();
	});

	test("extracts --step filter and resolves matching step", async () => {
		const state = makeState({ "my-pipe": { spec: step } });
		const result = await parseCaptainRunArgs(
			"my-pipe --step Research hello",
			state,
			"/cwd",
			() => {
				/* noop */
			},
		);
		expect(result?.stepFilter).toBe("Research");
		expect(result?.specToRun).toBe(step);
	});

	test("returns null and notifies when --step label not found", async () => {
		const state = makeState({ "my-pipe": { spec: step } });
		const errors: string[] = [];
		const result = await parseCaptainRunArgs(
			"my-pipe --step Unknown hello",
			state,
			"/cwd",
			(m, lvl) => {
				if (lvl === "error") errors.push(m);
			},
		);
		expect(result).toBeNull();
		expect(errors[0]).toContain("Unknown");
	});

	test("lists loaded pipelines in the usage message when no name given and pipelines exist", async () => {
		const state = makeState({ "pipe-a": { spec: step } });
		const infos: string[] = [];
		await parseCaptainRunArgs("", state, "/cwd", (m, lvl) => {
			if (lvl === "info") infos.push(m);
		});
		expect(infos[0]).toContain("pipe-a");
	});
});
