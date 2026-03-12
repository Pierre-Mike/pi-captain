import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Shared clear logic — only callable from command context which has newSession/reload
async function clearSession(ctx: any) {
	await ctx.waitForIdle();
	await ctx.newSession();
	await ctx.reload();
	ctx.ui.notify(
		"Context cleared & runtime reloaded — fresh session started",
		"info",
	);
}

export default function (pi: ExtensionAPI) {
	// Register /clear command
	pi.registerCommand("clear", {
		description: "Clear the conversation context and start a fresh session",
		handler: async (_args, ctx) => clearSession(ctx),
	});

	// Register /c as a single-letter alias for /clear
	pi.registerCommand("c", {
		description: "Alias for /clear — fresh session + reload",
		handler: async (_args, ctx) => clearSession(ctx),
	});

	// Intercept bare "c" or "clear" typed as a plain message (no slash prefix)
	pi.on("user_message", async (event, ctx) => {
		const trimmed = event.text.trim().toLowerCase();
		if (trimmed === "c" || trimmed === "clear") {
			await clearSession(ctx);
			return { block: true, reason: "Handled as clear shortcut" };
		}
	});
}
