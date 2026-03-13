// ── ui/commands-register-c.ts — /captain-kill /captain-jobs ──────────────
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { CaptainState } from "../state.js";

export function registerCommandsC(pi: ExtensionAPI, state: CaptainState): void {
	// /captain-kill [id] — kill a running job, or list running jobs
	pi.registerCommand("captain-kill", {
		description: "Kill a running pipeline job: /captain-kill <id>",
		getArgumentCompletions: (_prefix) =>
			[...state.jobs.values()]
				.filter((j) => j.state.status === "running")
				.map((j) => ({
					value: String(j.id),
					label: `#${j.id} — ${j.state.name}`,
				})),
		handler: async (args, ctx) => {
			const raw = args?.trim() ?? "";

			// No arg → list running jobs
			if (!raw) {
				const running = [...state.jobs.values()].filter(
					(j) => j.state.status === "running",
				);
				if (running.length === 0) {
					ctx.ui.notify("No running jobs.", "info");
					return;
				}
				const lines = [
					"Running jobs:",
					...running.map((j) => `  #${j.id}  ${j.state.name}`),
				];
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			const id = Number(raw);
			if (Number.isNaN(id)) {
				ctx.ui.notify(
					`Invalid job ID: "${raw}". Usage: /captain-kill <id>`,
					"error",
				);
				return;
			}

			const outcome = state.killJob(id);
			if (outcome === "killed") {
				ctx.ui.notify(`Job #${id} killed.`, "info");
			} else if (outcome === "not-running") {
				const status = state.jobs.get(id)?.state.status ?? "unknown";
				ctx.ui.notify(
					`Job #${id} is not running (status: ${status}).`,
					"error",
				);
			} else {
				ctx.ui.notify(
					`No job #${id} found. Use /captain-jobs to list all jobs.`,
					"error",
				);
			}
		},
	});

	// /captain-jobs — list all jobs (running, completed, failed, cancelled)
	pi.registerCommand("captain-jobs", {
		description: "List all pipeline jobs with their status and ID",
		handler: async (_args, ctx) => {
			const jobs = [...state.jobs.values()];
			if (jobs.length === 0) {
				ctx.ui.notify("No jobs have been run yet.", "info");
				return;
			}

			const statusEmoji: Record<string, string> = {
				running: "⏳",
				completed: "✓",
				failed: "✗",
				cancelled: "⊘",
				idle: "·",
			};

			const lines = [
				"── Captain Jobs ─────────────────────────────────────────",
				...jobs.map((j) => {
					const s = j.state;
					const icon = statusEmoji[s.status] ?? "?";
					const elapsed =
						s.endTime && s.startTime
							? ` ${((s.endTime - s.startTime) / 1000).toFixed(1)}s`
							: s.startTime
								? " (running…)"
								: "";
					return `  ${icon} #${j.id}  ${s.status.padEnd(10)}  ${s.name}${elapsed}`;
				}),
				"",
				"Kill a running job: /captain-kill <id>",
			];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
