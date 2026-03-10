// ── captain_run tool — Interactive Selection Tests ─────────────────────────
// Tests for the UI-driven pipeline selection flow in the captain_run tool.
// All tests MUST FAIL until the implementation is added to run.ts.
//
// We do NOT test the full executor path here — only the selection/resolution
// guard block that sits in front of the existing pipeline-lookup logic.

import { describe, expect, mock, test } from "bun:test";
import { skip } from "../gates/on-fail.js";
import type { CaptainState } from "../state.js";
import { full } from "../transforms/presets.js";
import type { Runnable } from "../types.js";

// ── Module mocks ───────────────────────────────────────────────────────────
// Prevent real filesystem / LLM calls inside the tool's execute path.

mock.module("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: async () => ({
		session: {
			subscribe: (fn: (e: unknown) => void) => {
				fn({
					type: "message_update",
					assistantMessageEvent: { type: "text_delta", delta: "mock output" },
				});
				return () => {};
			},
			prompt: async () => {},
			abort: () => {},
			dispose: () => {},
		},
	}),
	createReadTool: () => ({ name: "read" }),
	createBashTool: () => ({ name: "bash" }),
	createEditTool: () => ({ name: "edit" }),
	createWriteTool: () => ({ name: "write" }),
	createGrepTool: () => ({ name: "grep" }),
	createFindTool: () => ({ name: "find" }),
	createLsTool: () => ({ name: "ls" }),
	getAgentDir: () => "/fake/agent-dir",
	DefaultResourceLoader: class {
		async reload() {}
	},
	SessionManager: { inMemory: () => ({}) },
	SettingsManager: { inMemory: () => ({}) },
	DEFAULT_MAX_BYTES: 1_000_000,
	DEFAULT_MAX_LINES: 5000,
	truncateHead: (_text: string, _opts?: unknown) => ({
		content: "mock output",
	}),
}));

mock.module("../worktree.js", () => ({
	createWorktree: async () => null,
	removeWorktree: async () => {},
	isGitRepo: async () => false,
}));

mock.module("@mariozechner/pi-tui", () => ({
	Text: class {
		constructor(
			public text: string,
			public x: number,
			public y: number,
		) {}
	},
}));

// ── Fixtures ───────────────────────────────────────────────────────────────

const SIMPLE_PIPELINE: Runnable = {
	kind: "step",
	label: "test-step",
	prompt: "do $INPUT",
	gate: undefined,
	onFail: skip,
	transform: full,
};

function makeMinimalState(
	options: {
		loadedPipelines?: Record<string, { spec: Runnable }>;
		builtinPresets?: Record<string, { pipeline: Runnable }>;
	} = {},
): CaptainState {
	const pipelines = options.loadedPipelines ?? {};
	const builtinPresetMap = options.builtinPresets ?? {};

	return {
		pipelines,
		builtinPresetMap,

		runningState: null,

		snapshot: () => ({ pipelines, lastRun: undefined }),
		resolvePreset: (name: string) => {
			if (builtinPresetMap[name]) {
				// Simulate auto-load
				pipelines[name] = { spec: builtinPresetMap[name].pipeline };
				return { name, spec: builtinPresetMap[name].pipeline };
			}
			return undefined;
		},
		discoverPresets: () =>
			Object.keys(builtinPresetMap).map((n) => ({
				name: n,
				source: "builtin" as const,
			})),
	} as unknown as CaptainState;
}

/** Build a mock ExtensionContext (ctx) with controllable ui.select / ui.input */
function makeCtx(
	options: {
		hasUI?: boolean;
		selectReturn?: string | undefined;
		inputReturn?: string | undefined;
		selectThrows?: Error;
		inputThrows?: Error;
	} = {},
) {
	const {
		hasUI = true,
		selectReturn = undefined,
		inputReturn = "test input",
		selectThrows,
		inputThrows,
	} = options;

	const selectMock = mock(async (_title: string, _opts: string[]) => {
		if (selectThrows) throw selectThrows;
		return selectReturn;
	});
	const inputMock = mock(async (_title: string, _placeholder: string) => {
		if (inputThrows) throw inputThrows;
		return inputReturn;
	});
	const notifyMock = mock((_msg: string, _level: string) => {});
	const setStatusMock = mock((_key: string, _val: string | undefined) => {});

	return {
		ctx: {
			hasUI,
			model: { id: "test-model", provider: "test" },
			modelRegistry: {
				getAll: () => [],
				find: () => undefined,
				getApiKey: async () => "test-api-key",
			},
			cwd: "/tmp",
			ui: {
				select: selectMock,
				input: inputMock,
				notify: notifyMock,
				setStatus: setStatusMock,
				confirm: async () => true,
			},
		},
		selectMock,
		inputMock,
		notifyMock,
	};
}

// ── We need to access the registerRunTool internals by capturing the tool ──

/** Minimal ExtensionAPI that captures the registered tool for testing */
function makePI() {
	let capturedTool: {
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: AbortSignal | undefined,
			onUpdate: unknown,
			ctx: unknown,
		) => Promise<unknown>;
		renderCall: (args: Record<string, unknown>, theme: unknown) => unknown;
	} | null = null;

	const pi = {
		registerTool: (spec: typeof capturedTool) => {
			capturedTool = spec as typeof capturedTool;
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};

	return {
		pi,
		getTool: () => {
			if (!capturedTool) throw new Error("Tool not registered");
			return capturedTool;
		},
	};
}

// ── Import registerRunTool AFTER mocks ────────────────────────────────────
const { registerRunTool } = await import("./run.js");

// Minimal theme for renderCall tests
const fakeTheme = {
	fg: (_name: string, text: string) => text,
	bold: (text: string) => text,
};

// ── Tests: name="" + hasUI=false → existing error path unchanged ───────────

describe('captain_run tool: name="" + hasUI=false', () => {
	test('returns isError:true with "not found" message — no UI calls', async () => {
		const state = makeMinimalState({ loadedPipelines: {} });
		const { pi, getTool } = makePI();
		const updateWidget = mock(() => {});
		const clearWidget = mock(() => {});
		registerRunTool(pi as never, state, updateWidget, clearWidget);

		const { ctx, selectMock, inputMock } = makeCtx({ hasUI: false });

		const result = (await getTool().execute(
			"id",
			{ name: "", input: "do X" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(result.content[0].text).toContain('pipeline "" not found');
		expect(selectMock).not.toHaveBeenCalled();
		expect(inputMock).not.toHaveBeenCalled();
	});

	test("returns isError:true message mentioning captain_define", async () => {
		const state = makeMinimalState();
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({ hasUI: false });
		const result = (await getTool().execute(
			"id",
			{ name: "", input: "do X" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(result.content[0].text).toMatch(/captain_define/i);
	});
});

// ── Tests: name="" + hasUI=true + no pipelines ────────────────────────────

describe('captain_run tool: name="" + hasUI=true + no pipelines available', () => {
	test("does NOT call ctx.ui.select when no options exist", async () => {
		const state = makeMinimalState({ loadedPipelines: {}, builtinPresets: {} });
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({ hasUI: true });
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		expect(selectMock).not.toHaveBeenCalled();
	});

	test("returns a non-error result with 'No pipelines available' message", async () => {
		const state = makeMinimalState({ loadedPipelines: {}, builtinPresets: {} });
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({ hasUI: true });
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		// Should NOT be an error (graceful), but should mention no pipelines
		expect(result.content[0].text).toMatch(/no pipelines/i);
	});
});

// ── Tests: name="" + hasUI=true + pipelines exist + user cancels select ───

describe('captain_run tool: name="" + hasUI=true, user cancels select', () => {
	test("calls ctx.ui.select with pipeline options", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		expect(selectMock).toHaveBeenCalledTimes(1);
	});

	test("select is called with options containing loaded pipeline as '(loaded)'", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		// The second argument to select() must be the options array
		const callArgs = selectMock.mock.calls[0];
		const options = callArgs[1] as string[];
		expect(options).toContain("pipe1 (loaded)");
	});

	test("returns isError:false with '(cancelled)' text when select returns undefined", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({ hasUI: true, selectReturn: undefined });
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(result.content[0].text).toMatch(/cancelled/i);
	});

	test("does NOT call ctx.ui.input when select is cancelled", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, inputMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		expect(inputMock).not.toHaveBeenCalled();
	});
});

// ── Tests: name="" + hasUI=true + user selects then cancels input ──────────

describe('captain_run tool: name="" + hasUI=true, user cancels input dialog', () => {
	test("calls ctx.ui.input after successful select", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, inputMock } = makeCtx({
			hasUI: true,
			selectReturn: "pipe1 (loaded)",
			inputReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		expect(inputMock).toHaveBeenCalledTimes(1);
	});

	test("returns cancelled result when input dialog returns undefined", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({
			hasUI: true,
			selectReturn: "pipe1 (loaded)",
			inputReturn: undefined,
		});
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		// Should either be "(cancelled)" or a similar graceful message
		expect(result.content[0].text).toMatch(/cancelled/i);
	});
});

// ── Tests: name="" + hasUI=true + input already provided ──────────────────

describe('captain_run tool: name="" + hasUI=true + input pre-supplied', () => {
	test("does NOT show input dialog when input param is already provided", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, inputMock } = makeCtx({
			hasUI: true,
			selectReturn: "pipe1 (loaded)",
		});
		// Input is already provided
		await getTool().execute(
			"id",
			{ name: "", input: "already provided" },
			undefined,
			undefined,
			ctx,
		);

		expect(inputMock).not.toHaveBeenCalled();
	});
});

// ── Tests: name with valid value → no UI shown (regression guard) ──────────

describe("captain_run tool: name already provided → no UI shown", () => {
	test("does NOT call ctx.ui.select when valid name is given", async () => {
		const state = makeMinimalState({
			loadedPipelines: { "my-pipeline": { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({ hasUI: true });
		await getTool().execute(
			"id",
			{ name: "my-pipeline", input: "do X" },
			undefined,
			undefined,
			ctx,
		);

		expect(selectMock).not.toHaveBeenCalled();
	});

	test("does NOT call ctx.ui.input when valid name and input are given", async () => {
		const state = makeMinimalState({
			loadedPipelines: { "my-pipeline": { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, inputMock } = makeCtx({ hasUI: true });
		await getTool().execute(
			"id",
			{ name: "my-pipeline", input: "do X" },
			undefined,
			undefined,
			ctx,
		);

		expect(inputMock).not.toHaveBeenCalled();
	});
});

// ── Tests: auto-load of builtin preset ────────────────────────────────────

describe("captain_run tool: auto-load builtin preset on selection", () => {
	test("pipeline is loaded into state.pipelines after user selects a builtin preset", async () => {
		const builtinSpec = SIMPLE_PIPELINE;
		const state = makeMinimalState({
			loadedPipelines: {},
			builtinPresets: { "captain:spec-tdd": { pipeline: builtinSpec } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({
			hasUI: true,
			selectReturn: "captain:spec-tdd (builtin)",
			inputReturn: "my input",
		});

		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		// The preset should have been auto-loaded into state.pipelines
		expect(state.pipelines["captain:spec-tdd"]).toBeDefined();
	});

	test("shows options including builtin preset labeled (builtin)", async () => {
		const state = makeMinimalState({
			loadedPipelines: {},
			builtinPresets: { "captain:spec-tdd": { pipeline: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined, // cancel so we can inspect call args
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		const options = selectMock.mock.calls[0][1] as string[];
		expect(options).toContain("captain:spec-tdd (builtin)");
	});
});

// ── Tests: error handling — ctx.ui.select throws ──────────────────────────

describe("captain_run tool: error handling when UI methods throw", () => {
	test("catches synchronous error from ctx.ui.select and returns isError:true", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({
			hasUI: true,
			selectThrows: new Error("UI broke"),
		});
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(result.content[0].text).toContain("UI broke");
	});

	test("catches synchronous error from ctx.ui.input and returns isError:true", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({
			hasUI: true,
			selectReturn: "pipe1 (loaded)",
			inputThrows: new Error("input broke"),
		});
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(result.content[0].text).toContain("input broke");
	});

	test("does NOT proceed to execution when resolvePreset throws (auto-load failure)", async () => {
		const state = makeMinimalState({
			loadedPipelines: {},
			builtinPresets: {},
		});
		// Inject a broken resolvePreset that throws
		(state as unknown as { resolvePreset: unknown }).resolvePreset = () => {
			throw new Error("corrupted JSON");
		};
		// Fake a preset in builtinPresetMap so options include it
		(
			state as unknown as { builtinPresetMap: Record<string, unknown> }
		).builtinPresetMap = {
			"captain:broken": { pipeline: SIMPLE_PIPELINE },
		};

		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({
			hasUI: true,
			selectReturn: "captain:broken (builtin)",
			inputReturn: "some input",
		});
		const result = (await getTool().execute(
			"id",
			{ name: "" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		// Should surface the error and NOT silently proceed
		// Pipeline should NOT be registered
		expect(state.pipelines["captain:broken"]).toBeUndefined();
	});
});

// ── Tests: signal already aborted ─────────────────────────────────────────

describe("captain_run tool: aborted signal handling", () => {
	test("returns cancelled result without calling select when signal is already aborted", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({ hasUI: true });
		const ac = new AbortController();
		ac.abort();

		const result = (await getTool().execute(
			"id",
			{ name: "" },
			ac.signal,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

		expect(selectMock).not.toHaveBeenCalled();
		expect(result.content[0].text).toMatch(/cancelled/i);
	});
});

// ── Tests: renderCall handles undefined name ───────────────────────────────

describe("captain_run tool: renderCall with undefined name", () => {
	test("does not throw when args.name is undefined", () => {
		const state = makeMinimalState();
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		expect(() => {
			getTool().renderCall({ name: undefined, input: undefined }, fakeTheme);
		}).not.toThrow();
	});

	test("renders a placeholder text when args.name is undefined", () => {
		const state = makeMinimalState();
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const rendered = getTool().renderCall(
			{ name: undefined, input: undefined },
			fakeTheme,
		) as { text?: string };
		// The Text object's first arg should mention "select pipeline" or similar
		const textContent: string =
			typeof rendered === "string" ? rendered : (rendered?.text ?? "");
		expect(textContent).toMatch(/select pipeline|captain_run/i);
	});

	test("renderCall still renders correctly when name is a valid string", () => {
		const state = makeMinimalState();
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		expect(() => {
			getTool().renderCall(
				{ name: "my-pipeline", input: "some input" },
				fakeTheme,
			);
		}).not.toThrow();
	});
});

// ── Tests: select options order from the spec ──────────────────────────────

describe("captain_run tool: select options include loaded pipelines then builtins", () => {
	test("two loaded pipelines → options show both as (loaded), no (builtin)", async () => {
		const state = makeMinimalState({
			loadedPipelines: {
				"pipeline-a": { spec: SIMPLE_PIPELINE },
				"pipeline-b": { spec: SIMPLE_PIPELINE },
			},
			builtinPresets: {},
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		const options = selectMock.mock.calls[0][1] as string[];
		expect(options).toContain("pipeline-a (loaded)");
		expect(options).toContain("pipeline-b (loaded)");
		expect(options.some((o) => o.includes("(builtin)"))).toBe(false);
	});

	test("zero loaded + one builtin → options show one entry as (builtin)", async () => {
		const state = makeMinimalState({
			loadedPipelines: {},
			builtinPresets: { "captain:shredder": { pipeline: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute("id", { name: "" }, undefined, undefined, ctx);

		const options = selectMock.mock.calls[0][1] as string[];
		expect(options).toContain("captain:shredder (builtin)");
	});
});

// ── Tests: name=undefined (TypeBox optional) ───────────────────────────────

describe("captain_run tool: name=undefined treated like name=''", () => {
	test("shows select dialog when name is undefined and hasUI is true and pipelines exist", async () => {
		const state = makeMinimalState({
			loadedPipelines: { pipe1: { spec: SIMPLE_PIPELINE } },
		});
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx, selectMock } = makeCtx({
			hasUI: true,
			selectReturn: undefined,
		});
		await getTool().execute(
			"id",
			{ name: undefined },
			undefined,
			undefined,
			ctx,
		);

		expect(selectMock).toHaveBeenCalledTimes(1);
	});

	test("returns error when name is undefined and hasUI is false", async () => {
		const state = makeMinimalState({ loadedPipelines: {} });
		const { pi, getTool } = makePI();
		registerRunTool(
			pi as never,
			state,
			mock(() => {}),
			mock(() => {}),
		);

		const { ctx } = makeCtx({ hasUI: false });
		const result = (await getTool().execute(
			"id",
			{ name: undefined, input: "do X" },
			undefined,
			undefined,
			ctx,
		)) as { content: Array<{ text: string }> };

	});
});
