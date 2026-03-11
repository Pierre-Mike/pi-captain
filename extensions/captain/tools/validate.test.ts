import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { CaptainState } from "../state.js";
import { registerValidateTool } from "./validate.js";

type ToolExecute = (
	id: string,
	params: Record<string, unknown>,
	...rest: unknown[]
) => Promise<{ content: { type: string; text: string }[] }>;
type MockPi = ExtensionAPI & { lastTool: { execute: ToolExecute } };
const createMockPi = (): MockPi => {
	let lastTool: { execute: ToolExecute } | undefined;
	const mock = {
		get lastTool() {
			// biome-ignore lint/style/noNonNullAssertion: always set before access in tests
			return lastTool as { execute: ToolExecute };
		},
		registerTool: (tool: { execute: ToolExecute }) => {
			lastTool = tool;
		},
	};
	return mock as unknown as MockPi;
};

describe("captain_validate tool", () => {
	test("validates a valid step spec", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const validStepSpec = JSON.stringify({
			kind: "step",
			label: "Test Step",
			prompt: "Do something with $INPUT",
			// transform is optional, defaults to 'full'
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: validStepSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✓");
		expect(result.content[0].text).toContain("valid");
	});

	test("catches missing required fields in step", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const invalidStepSpec = JSON.stringify({
			kind: "step",
			// missing label, prompt
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: invalidStepSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("missing required field 'label'");
		expect(result.content[0].text).toContain("missing required field 'prompt'");
	});

	test("catches missing merge in parallel", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const invalidParallelSpec = JSON.stringify({
			kind: "parallel",
			steps: [
				{
					kind: "step",
					label: "Step 1",
					prompt: "Do something",
				},
			],
			// missing merge
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: invalidParallelSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("missing required field 'merge'");
	});

	test("catches missing merge in pool", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const invalidPoolSpec = JSON.stringify({
			kind: "pool",
			step: {
				kind: "step",
				label: "Pool Step",
				prompt: "Do something",
			},
			count: 3,
			// missing merge
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: invalidPoolSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("missing required field 'merge'");
	});

	test("validates already-loaded pipeline by name", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		// Load a valid pipeline first
		state.pipelines["test-pipeline"] = {
			spec: {
				kind: "step",
				label: "Test Step",
				prompt: "Do something",
			} as import("../types.js").Runnable,
		};

		const result = await pi.lastTool.execute(
			"test",
			{ name: "test-pipeline" },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✓");
		expect(result.content[0].text).toContain("valid");
	});

	test("handles non-existent pipeline name", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const result = await pi.lastTool.execute(
			"test",
			{ name: "non-existent" },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("not found");
	});

	test("handles malformed JSON", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const result = await pi.lastTool.execute(
			"test",
			{ spec: "{ invalid json }" },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("Error parsing");
	});

	test("validates nested structures recursively", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const nestedSpec = JSON.stringify({
			kind: "sequential",
			steps: [
				{
					kind: "step",
					label: "Valid Step",
					prompt: "Do something",
				},
				{
					kind: "step",
					label: "Invalid Step",
					// missing prompt
				},
			],
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: nestedSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("root.steps[1]");
		expect(result.content[0].text).toContain("missing required field 'prompt'");
	});

	test("catches empty steps array in sequential", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const invalidSpec = JSON.stringify({
			kind: "sequential",
			steps: [],
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: invalidSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("steps' array cannot be empty");
	});

	test("catches unknown runnable kind", async () => {
		const pi = createMockPi();
		const state = new CaptainState("");
		registerValidateTool(pi, state);

		const invalidSpec = JSON.stringify({
			kind: "unknown",
		});

		const result = await pi.lastTool.execute(
			"test",
			{ spec: invalidSpec },
			undefined,
			undefined,
			undefined,
		);

		expect(result.content[0].text).toContain("✗");
		expect(result.content[0].text).toContain("Unknown kind 'unknown'");
	});
});
