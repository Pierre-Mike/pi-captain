// runner.ts — Shell runner for the FreeCAD agent

import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RUNNER = path.join(
	path.dirname(new URL(import.meta.url).pathname),
	"../../skills/freecad/freecad_run.sh",
);

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const LOG_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
const LOG_LINE_MS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \|/;
const LIB_ERR = "Error: Failed to open library";

function cleanOutput(s: string, filterMs = false): string {
	return (s || "")
		.replace(ANSI_RE, "")
		.split("\n")
		.filter((l) => !(filterMs ? LOG_LINE_MS : LOG_LINE).test(l))
		.filter((l) => !l.startsWith(LIB_ERR))
		.join("\n")
		.trim();
}

export async function runAgent(args: string[]): Promise<string> {
	try {
		const { stdout, stderr } = await execFileAsync(RUNNER, args, {
			timeout: 120_000,
		});
		return (
			cleanOutput(stdout, true) || cleanOutput(stderr, true) || "(no output)"
		);
	} catch (err: unknown) {
		let raw = "";
		if (err instanceof Error) {
			const e = err as Error & { stderr?: string; stdout?: string };
			raw = e.stderr || e.stdout || err.message;
		} else {
			raw = String(err);
		}
		return `ERROR: ${cleanOutput(raw)}`;
	}
}
