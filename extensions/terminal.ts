import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateTail } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const runCommand = async (args: string, ctx: any) => {
		if (!args.trim()) {
			ctx.ui.notify("Usage: /terminal <command>  or  /t <command>", "warning");
			return;
		}

		const cwd = ctx.cwd;

		try {
			const result = await pi.exec("bash", ["-c", args], { timeout: 30000 });

			const rawOutput = [
				result.stdout ? `STDOUT:\n${result.stdout}` : "",
				result.stderr ? `STDERR:\n${result.stderr}` : "",
				`Exit code: ${result.code}`,
			]
				.filter(Boolean)
				.join("\n\n");

			const { content, truncated, totalLines, outputLines } = truncateTail(
				rawOutput,
				{
					maxLines: 200,
					maxBytes: 20 * 1024,
				},
			);

			const header = `$ ${args}  (cwd: ${cwd})`;
			const footer = truncated
				? `\n… truncated — showing last ${outputLines} of ${totalLines} lines`
				: "";

			const full = `${header}\n${"─".repeat(Math.min(header.length, 80))}\n${content}${footer}`;

			if (ctx.hasUI) {
				// Show in a dismiss-able notification for short output, else notify + send to chat
				if (content.split("\n").length <= 20 && content.length < 800) {
					ctx.ui.notify(full, result.code === 0 ? "info" : "error");
				} else {
					ctx.ui.notify(
						`Command finished (exit ${result.code}). Output injected into chat.`,
						result.code === 0 ? "info" : "warning",
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
			} else {
				// Non-interactive mode — always inject into chat
				pi.sendMessage(
					{
						customType: "terminal-result",
						content: `\`\`\`\n${full}\n\`\`\``,
						display: true,
					},
					{ triggerTurn: false },
				);
			}
		} catch (err: any) {
			const msg = err?.message ?? String(err);
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
