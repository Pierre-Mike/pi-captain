// ── tools/status.ts — captain_status tool registration ───────────────────
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { PipelineState, StepResult } from "../core/types.js";
import { statusIcon } from "../core/utils/index.js";
import type { CaptainState } from "../state.js";

// ── Formatting helpers ─────────────────────────────────────────────────────

const OUTPUT_PREVIEW_CHARS = 600;

function stepLines(r: StepResult): string[] {
	const gate = r.gateResult
		? ` [gate: ${r.gateResult.passed ? "pass" : `FAIL — ${r.gateResult.reason}`}]`
		: "";
	const err = r.error ? ` — ${r.error}` : "";
	const header = `${statusIcon(r.status)} ${r.label}: ${r.status} (${(r.elapsed / 1000).toFixed(1)}s)${gate}${err}`;

	// For failed/skipped steps, show what the agent actually produced
	if ((r.status === "failed" || r.status === "skipped") && r.output.trim()) {
		const preview = r.output.trim().slice(0, OUTPUT_PREVIEW_CHARS);
		const truncated =
			r.output.trim().length > OUTPUT_PREVIEW_CHARS ? "…(truncated)" : "";
		return [header, `    └─ output: ${preview}${truncated}`];
	}
	return [header];
}

function buildStatusLines(s: PipelineState): string[] {
	const elapsed =
		s.endTime && s.startTime
			? ` (${((s.endTime - s.startTime) / 1000).toFixed(1)}s total)`
			: "";

	const lines = [
		`Job #${s.jobId ?? "?"} — Pipeline: ${s.name} — Status: ${s.status}`,
		s.startTime ? `Started: ${new Date(s.startTime).toISOString()}` : "",
		s.endTime ? `Ended: ${new Date(s.endTime).toISOString()}${elapsed}` : "",
		"",
		"── Steps ──",
		...s.results.flatMap(stepLines),
	].filter(Boolean);

	if (s.finalOutput) {
		lines.push("", "── Final Output ──", s.finalOutput.slice(0, 2000));
	}
	return lines;
}

function buildJobListLines(state: CaptainState): string[] {
	const jobs = [...state.jobs.values()];
	if (jobs.length === 0) return ["No jobs have been run yet."];

	const lines: string[] = ["── All Jobs ──"];
	for (const job of jobs) {
		const s = job.state;
		const elapsed =
			s.endTime && s.startTime
				? ` ${((s.endTime - s.startTime) / 1000).toFixed(1)}s`
				: s.startTime
					? " (running…)"
					: "";
		const steps = s.results.length;
		lines.push(
			`  #${job.id}  ${s.status.padEnd(10)}  ${s.name}  [${steps} step(s)${elapsed}]`,
		);
	}
	lines.push(
		"",
		'Pass name or id for details: captain_status { "name": "..." }',
	);
	return lines;
}

// ── Tool registration ──────────────────────────────────────────────────────

export function registerStatusTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_status",
		label: "Captain Status",
		description:
			"Check status of a running or completed captain pipeline. Pass name or id for details, or omit both to list all jobs.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Pipeline name" })),
			id: Type.Optional(Type.Number({ description: "Job ID" })),
		}),

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			// No filter → list all jobs
			if (!params.name && params.id === undefined) {
				return {
					content: [
						{ type: "text", text: buildJobListLines(state).join("\n") },
					],
					details: undefined,
				};
			}

			// Lookup by job ID
			if (params.id !== undefined) {
				const job = state.jobs.get(params.id);
				if (!job) {
					return {
						content: [{ type: "text", text: `No job #${params.id} found.` }],
						details: undefined,
					};
				}
				return {
					content: [
						{ type: "text", text: buildStatusLines(job.state).join("\n") },
					],
					details: undefined,
				};
			}

			// Lookup by name — find most recent matching job
			const name = params.name ?? "";
			const matching = [...state.jobs.values()]
				.filter((j) => j.state.name === name)
				.at(-1);

			if (matching) {
				return {
					content: [
						{ type: "text", text: buildStatusLines(matching.state).join("\n") },
					],
					details: undefined,
				};
			}

			// Fallback: pipeline defined but never run
			const pipeline = state.pipelines[name];
			if (!pipeline) {
				return {
					content: [{ type: "text", text: `Pipeline "${name}" not found.` }],
					details: undefined,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Pipeline "${name}" defined but has not been run yet.`,
					},
				],
				details: undefined,
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_status")) +
					(args.id !== undefined
						? theme.fg("muted", ` #${args.id}`)
						: args.name
							? theme.fg("muted", ` ${args.name}`)
							: theme.fg("dim", " — all jobs")),
				0,
				0,
			),
	});
}
