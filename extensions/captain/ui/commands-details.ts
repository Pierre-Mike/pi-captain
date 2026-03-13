// ── ui/commands-details.ts — Pipeline detail display helper ─────────────────
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { describeRunnable } from "../core/utils/index.js";
import type { CaptainState } from "../state.js";

export async function showPipelineDetails(
	name: string,
	state: CaptainState,
	ctx: ExtensionCommandContext,
): Promise<void> {
	const p = state.pipelines[name];
	if (p) {
		ctx.ui.notify(
			`Pipeline "${name}":\n${describeRunnable(p.spec, 0)}`,
			"info",
		);
		return;
	}
	try {
		const resolved = await state.resolvePreset(name, ctx.cwd);
		if (resolved) {
			ctx.ui.notify(
				`Pipeline "${name}" (${resolved.source ?? "preset"} — not yet loaded):\n${describeRunnable(resolved.spec, 0)}`,
				"info",
			);
			return;
		}
	} catch {
		/* fall through */
	}
	ctx.ui.notify(`Pipeline "${name}" not found.`, "error");
}
