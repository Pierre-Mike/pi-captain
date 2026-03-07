import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import type { CaptainState } from "../state.js";
import type { Agent, AgentName, CaptainDetails } from "../types.js";

export function registerAgentTool(pi: ExtensionAPI, state: CaptainState) {
	pi.registerTool({
		name: "captain_agent",
		label: "Captain Agent",
		description:
			"Define a reusable agent config with name, description, tools, model, and temperature. Agents are referenced by name in pipeline steps.",
		parameters: Type.Object({
			name: Type.String({ description: "Unique agent name" }),
			description: Type.String({ description: "What this agent does" }),
			tools: Type.String({
				description: "Comma-separated tool names (e.g. 'read,bash,edit')",
			}),
			model: Type.Optional(
				Type.String({
					description: "Model identifier (e.g. 'sonnet', 'flash')",
				}),
			),
			temperature: Type.Optional(
				Type.Number({ description: "Sampling temperature (0-1)" }),
			),
		}),

		async execute(_id, params) {
			const agent: Agent = {
				name: params.name as AgentName,
				description: params.description,
				tools: params.tools.split(",").map((t: string) => t.trim()),
				model: params.model,
				temperature: params.temperature,
				source: "runtime",
			};
			state.agents[params.name] = agent;

			return {
				content: [
					{
						type: "text",
						text: `Agent "${params.name}" defined: ${params.description} (tools: ${agent.tools.join(", ")})`,
					},
				],
				details: state.snapshot(),
			};
		},

		renderCall: (args, theme) =>
			new Text(
				theme.fg("toolTitle", theme.bold("captain_agent ")) +
					theme.fg("accent", args.name),
				0,
				0,
			),
		renderResult: (result, _opts, theme) => {
			const d = result.details as CaptainDetails | undefined;
			if (!d) return new Text(theme.fg("success", "✓ Agent defined"), 0, 0);
			const total = Object.keys(d.agents).length;
			const mdCount = Object.values(d.agents).filter(
				(a) => a.source === "md",
			).length;
			const rtCount = total - mdCount;
			return new Text(
				theme.fg(
					"success",
					`✓ ${total} agent(s) (${mdCount} md, ${rtCount} runtime)`,
				),
				0,
				0,
			);
		},
	});
}
