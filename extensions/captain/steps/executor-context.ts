// ── steps/executor-context.ts — ExecutorContext interface ────────────────
// Pure type definition extracted to keep runner.ts within 200-line limit.

import type { Api, Model } from "@mariozechner/pi-ai";
import type { DefaultResourceLoader } from "@mariozechner/pi-coding-agent";
import type { ModelRegistryLike, StepResult } from "../types.js";

/** Everything the executor needs from the host environment */
export interface ExecutorContext {
	exec: (
		cmd: string,
		args: readonly string[],
		opts?: { signal?: AbortSignal },
	) => Promise<{ stdout: string; stderr: string; code: number }>;
	model: Model<Api>;
	modelRegistry: ModelRegistryLike;
	apiKey: string;
	cwd: string;
	hasUI: boolean;
	confirm?: (title: string, body: string) => Promise<boolean>;
	signal?: AbortSignal;
	onStepStart?: (label: string) => void;
	onStepEnd?: (result: StepResult) => void;
	onStepStream?: (label: string, text: string) => void;
	onStepToolCall?: (label: string, totalCalls: number) => void;
	pipelineName: string;
	stepGroup?: string;
	loaderCache?: Map<string, DefaultResourceLoader>;
	isGitRepo?: boolean;
}
