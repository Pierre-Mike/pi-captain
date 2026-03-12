/**
 * FreeCAD tool definitions for the pi extension.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { runAgent } from "./runner.js";

const PromptParams = Type.Object({
	prompt: Type.String({
		description: "Natural language description of the CAD operation",
	}),
});

const CreateParams = Type.Object({
	shape: Type.Union(
		[Type.Literal("box"), Type.Literal("cylinder"), Type.Literal("sphere")],
		{ description: "Shape type to create" },
	),
	dimensions: Type.Array(Type.Number(), {
		description:
			"Dimensions: box=[length, width, height], cylinder=[radius, height], sphere=[radius]",
	}),
	output_dir: Type.String({ description: "Directory to save the .FCStd file" }),
	name: Type.Optional(
		Type.String({ description: "Optional name for the object" }),
	),
});

const ExportParams = Type.Object({
	input_file: Type.String({ description: "Path to the .FCStd source file" }),
	output_file: Type.String({
		description:
			"Path for the exported file (extension determines format if --format omitted)",
	}),
	format: Type.Optional(
		Type.Union(
			[
				Type.Literal("STEP"),
				Type.Literal("IGES"),
				Type.Literal("STL"),
				Type.Literal("DXF"),
				Type.Literal("PDF"),
			],
			{
				description:
					"Export format (inferred from output extension if omitted)",
			},
		),
	),
});

const BatchParams = Type.Object({
	directory: Type.String({ description: "Directory containing .FCStd files" }),
	pattern: Type.Optional(
		Type.String({ description: "Glob pattern (default: *.FCStd)" }),
	),
	operation: Type.Optional(
		Type.String({ description: "Operation to perform (default: export_step)" }),
	),
	parallel: Type.Optional(
		Type.Number({ description: "Number of parallel workers (default: 4)" }),
	),
});

export const freecadCapabilities: ToolDefinition = {
	name: "freecad_capabilities",
	label: "FreeCAD Capabilities",
	description:
		"Show what the FreeCAD agent can do and confirm FreeCAD is available.",
	parameters: Type.Object({}),
	async execute(_id, _params, _signal, _onUpdate, _ctx) {
		const output = await runAgent(["--show-capabilities"]);
		return { content: [{ type: "text", text: output }], details: {} };
	},
};

export const freecadPrompt: ToolDefinition = {
	name: "freecad_prompt",
	label: "FreeCAD Prompt",
	description:
		"Execute a natural language CAD command, e.g. 'Create a box 100x50x25'.",
	parameters: PromptParams,
	async execute(_id, params, _signal, _onUpdate, _ctx) {
		const { prompt } = params as { prompt: string };
		const output = await runAgent(["--prompt", prompt]);
		return { content: [{ type: "text", text: output }], details: {} };
	},
};

export const freecadCreate: ToolDefinition = {
	name: "freecad_create",
	label: "FreeCAD Create Shape",
	description:
		"Create a basic 3D shape (box, cylinder, sphere) and save it to a .FCStd file.",
	parameters: CreateParams,
	async execute(_id, params, _signal, _onUpdate, _ctx) {
		const { shape, dimensions, output_dir, name } = params as {
			shape: string;
			dimensions: number[];
			output_dir: string;
			name?: string;
		};
		const args = [
			"--create",
			shape,
			"--dimensions",
			...dimensions.map(String),
			"--output",
			output_dir,
		];
		if (name) args.push("--name", name);
		return {
			content: [{ type: "text", text: await runAgent(args) }],
			details: {},
		};
	},
};

export const freecadExport: ToolDefinition = {
	name: "freecad_export",
	label: "FreeCAD Export",
	description:
		"Open an existing .FCStd file and export it to STEP, IGES, STL, DXF, or PDF.",
	parameters: ExportParams,
	async execute(_id, params, _signal, _onUpdate, _ctx) {
		const { input_file, output_file, format } = params as {
			input_file: string;
			output_file: string;
			format?: string;
		};
		const args = ["--file", input_file, "--export", output_file];
		if (format) args.push("--format", format);
		return {
			content: [{ type: "text", text: await runAgent(args) }],
			details: {},
		};
	},
};

export const freecadBatch: ToolDefinition = {
	name: "freecad_batch",
	label: "FreeCAD Batch Export",
	description:
		"Batch-process all .FCStd files matching a glob pattern in a directory.",
	parameters: BatchParams,
	async execute(_id, params, _signal, _onUpdate, _ctx) {
		const { directory, pattern, operation, parallel } = params as {
			directory: string;
			pattern?: string;
			operation?: string;
			parallel?: number;
		};
		const args = [
			"--batch",
			"--input-directory",
			directory,
			"--pattern",
			pattern ?? "*.FCStd",
			"--operation",
			operation ?? "export_step",
			"--parallel",
			String(parallel ?? 4),
		];
		return {
			content: [{ type: "text", text: await runAgent(args) }],
			details: {},
		};
	},
};

export const allFreecadTools = [
	freecadCapabilities,
	freecadPrompt,
	freecadCreate,
	freecadExport,
	freecadBatch,
];
