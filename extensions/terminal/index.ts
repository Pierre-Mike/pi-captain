import { spawn } from "node:child_process";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";

const HOME = process.env.HOME ?? "";
const WIDGET_ID = "terminal";
const MAX_WIDGET_LINES = 20; // max lines shown live in the widget
const MAX_OUTPUT_LINES = 200;
const MAX_OUTPUT_BYTES = 20 * 1024;

function shortCwd(cwd: string): string {
	return HOME ? cwd.replace(HOME, "~") : cwd;
}

function drawBox(
	cmd: string,
	cwd: string,
	lines: string[],
	status: "running" | "ok" | "error",
	code?: number,
): string[] {
	const icon =
		status === "running" ? "⟳" : status === "ok" ? "✓" : `✗  exit ${code}`;

	const headerText = `❯ ${cmd}`;
	const cwdText = `  ${shortCwd(cwd)}`;
	const footerText = icon;
	const allTexts = [headerText, cwdText, ...lines, footerText];
	const width = Math.min(Math.max(...allTexts.map((l) => l.length)) + 2, 100);

	const pad = (s: string) => s + " ".repeat(Math.max(0, width - s.length - 2));
	const top = `┌${"─".repeat(width)}┐`;
	const sep = `├${"─".repeat(width)}┤`;
	const bottom = `└${"─".repeat(width)}┘`;
	const row = (s: string) => `│ ${pad(s)} │`;

	const result = [top, row(headerText), row(cwdText)];

	if (lines.length > 0) {
		result.push(sep);
		for (const line of lines) result.push(row(line));
	}

	result.push(sep, row(footerText), bottom);
	return result;
}

function buildFinalOutput(raw: string): string {
	const {
		content,
		truncated,
		totalLines,
		outputLines: shown,
	} = truncateTail(raw, {
		maxLines: MAX_OUTPUT_LINES,
		maxBytes: MAX_OUTPUT_BYTES,
	});
	return (
		content +
		(truncated
			? `\n… truncated — showing last ${shown} of ${totalLines} lines`
			: "")
	);
}

function notifyUI(
	ctx: ExtensionContext,
	args: string,
	cwd: string,
	out: string,
	ok: boolean,
	code: number,
): void {
	const displayLines = out.trimEnd().split("\n").slice(-MAX_WIDGET_LINES);
	ctx.ui.setWidget(WIDGET_ID, undefined);
	const boxLines = drawBox(args, cwd, displayLines, ok ? "ok" : "error", code);
	const boxStr = boxLines.join("\n");
	if (boxLines.length <= 35 && boxStr.length < 3000) {
		ctx.ui.notify(boxStr, ok ? "info" : "error");
	} else {
		ctx.ui.notify(
			`Command finished (exit ${code}). Output injected into chat.`,
			ok ? "info" : "warning",
		);
	}
}

function handleClose(
	code: number | null,
	args: string,
	cwd: string,
	outputLines: string[],
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): void {
	const exitCode = code ?? 1;
	const success = exitCode === 0;
	const finalOutput = buildFinalOutput(outputLines.join("\n").trimEnd());

	if (ctx.hasUI) notifyUI(ctx, args, cwd, finalOutput, success, exitCode);

	if (finalOutput.trim()) {
		const full = drawBox(
			args,
			cwd,
			finalOutput.trimEnd().split("\n"),
			success ? "ok" : "error",
			exitCode,
		).join("\n");
		pi.sendMessage(
			{
				customType: "terminal-result",
				content: `\`\`\`\n${full}\n\`\`\``,
				display: false,
			},
			{ triggerTurn: false },
		);
	}
}

function runCommand(
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionContext,
): void {
	const cwd = ctx.cwd;
	const outputLines: string[] = [];

	const updateWidget = (status: "running" | "ok" | "error", code?: number) => {
		if (!ctx.hasUI) return;
		// Show only the last output line live — widget area is too small for a full box
		const lastLine = outputLines.filter((l) => l.trim()).at(-1) ?? "";
		const icon =
			status === "running" ? "⟳" : status === "ok" ? "✓" : `✗ exit ${code}`;
		ctx.ui.setWidget(WIDGET_ID, [
			`${icon}  ❯ ${args}`,
			lastLine ? `   ${lastLine}` : "",
		]);
	};

	const proc = spawn("bash", ["-c", args], { cwd });

	const onData = (chunk: Buffer) => {
		const text = chunk.toString();
		const newLines = text.split("\n");
		// merge first new line onto last existing line (handles partial chunks)
		if (outputLines.length > 0 && newLines.length > 0) {
			outputLines[outputLines.length - 1] += newLines.shift() ?? "";
		}
		outputLines.push(...newLines);
		updateWidget("running");
	};

	proc.stdout.on("data", onData);
	proc.stderr.on("data", onData);

	updateWidget("running");

	proc.on("close", (code) =>
		handleClose(code, args, cwd, outputLines, ctx, pi),
	);

	proc.on("error", (err) => {
		if (ctx.hasUI) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			ctx.ui.notify(`Error: ${err.message}`, "error");
		}
	});
}

export default function (pi: ExtensionAPI) {
	const handler = (args: string, ctx: ExtensionContext) => {
		if (!args.trim()) {
			ctx.ui.notify("Usage: /t <command>", "warning");
			return Promise.resolve();
		}
		// Fire-and-forget — spawn runs in background, handler returns immediately
		runCommand(pi, args, ctx);
		return Promise.resolve();
	};

	pi.registerCommand("terminal", {
		description: "Run a shell command. Usage: /terminal <command>",
		handler,
	});

	pi.registerCommand("t", {
		description: "Run a shell command. Usage: /t <command>",
		handler,
	});

	pi.registerCommand("$", {
		description: "Run a shell command. Usage: /$ <command>",
		handler,
	});
}
