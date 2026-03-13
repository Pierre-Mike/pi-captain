import type {
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";

function formatOutput(
	stdout: string | undefined,
	stderr: string | undefined,
	code: number,
): string {
	return [
		stdout ? `STDOUT:\n${stdout}` : "",
		stderr ? `STDERR:\n${stderr}` : "",
		`Exit code: ${code}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

function buildFullOutput(
	args: string,
	cwd: string,
	content: string,
	truncated: boolean,
	outputLines: number,
	totalLines: number,
): string {
	const header = `$ ${args}  (cwd: ${cwd})`;
	const footer = truncated
		? `\n… truncated — showing last ${outputLines} of ${totalLines} lines`
		: "";

	return `${header}\n${"─".repeat(Math.min(header.length, 80))}\n${content}${footer}`;
}

function shouldShowAsNotification(content: string): boolean {
	return content.split("\n").length <= 20 && content.length < 800;
}

function handleUIOutput(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
	full: string,
	content: string,
	code: number,
): void {
	if (shouldShowAsNotification(content)) {
		ctx.ui.notify(full, code === 0 ? "info" : "error");
	} else {
		ctx.ui.notify(
			`Command finished (exit ${code}). Output injected into chat.`,
			code === 0 ? "info" : "warning",
		);
		pi.sendMessage(
			{
				customType: "terminal-result",
				content: `\`\`\`\n${full}\n\`\`\``,
				display: true,
			},
			{ triggerTurn: false },
		);
	}
}

function handleNonUIOutput(pi: ExtensionAPI, full: string): void {
	pi.sendMessage(
		{
			customType: "terminal-result",
			content: `\`\`\`\n${full}\n\`\`\``,
			display: true,
		},
		{ triggerTurn: false },
	);
}

export default function (pi: ExtensionAPI) {
	const runCommand = async (args: string, ctx: ExtensionContext) => {
		if (!args.trim()) {
			ctx.ui.notify("Usage: /terminal <command>  or  /t <command>", "warning");
			return;
		}

		const cwd = ctx.cwd;

		try {
			const result = await pi.exec("bash", ["-c", args], { timeout: 30000 });

			const rawOutput = formatOutput(result.stdout, result.stderr, result.code);

			const { content, truncated, totalLines, outputLines } = truncateTail(
				rawOutput,
				{
					maxLines: 200,
					maxBytes: 20 * 1024,
				},
			);

			const full = buildFullOutput(
				args,
				cwd,
				content,
				truncated,
				outputLines,
				totalLines,
			);

			if (ctx.hasUI) {
				handleUIOutput(ctx, pi, full, content, result.code);
			} else {
				handleNonUIOutput(pi, full);
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			if (ctx.hasUI) {
				ctx.ui.notify(`Error running command: ${msg}`, "error");
			}
		}
	};

	// Full name: /terminal
	pi.registerCommand("terminal", {
		description:
			"Run a shell command in the current working directory and display the output. Usage: /terminal <command>",
		handler: async (args, ctx) => {
			await runCommand(args, ctx);
		},
	});

	// Short alias: /t
	pi.registerCommand("t", {
		description:
			"Alias for /terminal — run a shell command. Usage: /t <command>",
		handler: async (args, ctx) => {
			await runCommand(args, ctx);
		},
	});
}
