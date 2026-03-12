/**
 * FreeCAD Extension for pi
 *
 * Registers a `freecad` tool that lets Claude drive the FreeCAD agent
 * (create geometry, open/save documents, batch-export files) via the
 * shell wrapper at skills/freecad/freecad_run.sh.
 *
 * The FreeCAD Python environment is fully self-contained inside the macOS
 * app bundle — no extra setup required beyond having FreeCAD installed at
 * /Applications/FreeCAD.app.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const execFileAsync = promisify(execFile);

const RUNNER = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	"../skills/freecad/freecad_run.sh",
);

async function runAgent(args: string[]): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync(RUNNER, args, {
			timeout: 120_000,
		});
		// Strip ANSI color codes and loguru noise from output
		const clean = (s: string) =>
			s
				.replace(/\x1b\[[0-9;]*m/g, "")
				.split("\n")
				.filter(
					(l) => !l.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \|/),
				)
				.filter((l) => !l.startsWith("Error: Failed to open library"))
				.join("\n")
				.trim();
		return clean(stdout) || clean(stderr) || "(no output)";
	} catch (err: any) {
		const clean = (s: string) =>
			(s || "")
				.replace(/\x1b\[[0-9;]*m/g, "")
				.split("\n")
				.filter((l) => !l.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/))
				.filter((l) => !l.startsWith("Error: Failed to open library"))
				.join("\n")
				.trim();
		const msg = clean(err.stderr || err.stdout || err.message || String(err));
		return `ERROR: ${msg}`;
	}
}

export default function freecadExtension(pi: ExtensionAPI) {
	// ── Capabilities ────────────────────────────────────────────────────────
	pi.registerTool({
		name: "freecad_capabilities",
		label: "FreeCAD Capabilities",
		description:
			"Show what the FreeCAD agent can do and confirm FreeCAD is available.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, _ctx) {
			const output = await runAgent(["--show-capabilities"]);
			return { content: [{ type: "text", text: output }], details: {} };
		},
	});

	// ── Natural language prompt ──────────────────────────────────────────────
	pi.registerTool({
		name: "freecad_prompt",
		label: "FreeCAD Prompt",
		description:
			"Execute a natural language CAD command, e.g. 'Create a box 100x50x25' or 'Create a cylinder radius 30 height 80'.",
		parameters: Type.Object({
			prompt: Type.String({
				description: "Natural language description of the CAD operation",
			}),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const output = await runAgent(["--prompt", params.prompt]);
			return { content: [{ type: "text", text: output }], details: {} };
		},
	});

	// ── Create shape ────────────────────────────────────────────────────────
	pi.registerTool({
		name: "freecad_create",
		label: "FreeCAD Create Shape",
		description:
			"Create a basic 3D shape (box, cylinder, sphere) and save it to a .FCStd file.",
		parameters: Type.Object({
			shape: Type.Union(
				[Type.Literal("box"), Type.Literal("cylinder"), Type.Literal("sphere")],
				{ description: "Shape type to create" },
			),
			dimensions: Type.Array(Type.Number(), {
				description:
					"Dimensions: box=[length, width, height], cylinder=[radius, height], sphere=[radius]",
			}),
			output_dir: Type.String({
				description: "Directory to save the .FCStd file",
			}),
			name: Type.Optional(
				Type.String({ description: "Optional name for the object" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const args = [
				"--create",
				params.shape,
				"--dimensions",
				...params.dimensions.map(String),
				"--output",
				params.output_dir,
			];
			if (params.name) args.push("--name", params.name);
			const output = await runAgent(args);
			return { content: [{ type: "text", text: output }], details: {} };
		},
	});

	// ── Open + export ────────────────────────────────────────────────────────
	pi.registerTool({
		name: "freecad_export",
		label: "FreeCAD Export",
		description:
			"Open an existing .FCStd file and export it to STEP, IGES, STL, DXF, or PDF.",
		parameters: Type.Object({
			input_file: Type.String({
				description: "Path to the .FCStd source file",
			}),
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
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const args = [
				"--file",
				params.input_file,
				"--export",
				params.output_file,
			];
			if (params.format) args.push("--format", params.format);
			const output = await runAgent(args);
			return { content: [{ type: "text", text: output }], details: {} };
		},
	});

	// ── Batch export ─────────────────────────────────────────────────────────
	pi.registerTool({
		name: "freecad_batch",
		label: "FreeCAD Batch Export",
		description:
			"Batch-process all .FCStd files matching a glob pattern in a directory (default operation: export to STEP).",
		parameters: Type.Object({
			directory: Type.String({
				description: "Directory containing .FCStd files",
			}),
			pattern: Type.Optional(
				Type.String({ description: "Glob pattern (default: *.FCStd)" }),
			),
			operation: Type.Optional(
				Type.String({
					description: "Operation to perform (default: export_step)",
				}),
			),
			parallel: Type.Optional(
				Type.Number({ description: "Number of parallel workers (default: 4)" }),
			),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const args = [
				"--batch",
				"--input-directory",
				params.directory,
				"--pattern",
				params.pattern ?? "*.FCStd",
				"--operation",
				params.operation ?? "export_step",
				"--parallel",
				String(params.parallel ?? 4),
			];
			const output = await runAgent(args);
			return { content: [{ type: "text", text: output }], details: {} };
		},
	});
}
