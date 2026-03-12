// ── Pipeline: Showcase ───────────────────────────────────────────────────
// A self-contained demo pipeline that exercises every step feature.
// Steps are split across showcase-steps-a.ts and showcase-steps-b.ts
// to stay within the 200-line limit per file (Basic_knowledge.md).
//
// Run:  captain_run { name: "captain:showcase", input: "list 5 hobbies" }
// Load: captain_load { action: "load", name: "captain:showcase" }

import { warn } from "../gates/on-fail.js";
import type { Gate, OnFail, Runnable, Sequential } from "../types.js";
import {
	brainstorm,
	challenge,
	expandParallel,
	formatStep,
	rankPool,
	summarizeStep,
} from "./showcase-steps-a.js";
import {
	fallbackDemo,
	llmFastDemo,
	retryDemo,
	toolDemo,
	warnDemo,
	webSearchDemo,
} from "./showcase-steps-b.js";

const noGate: Gate = () => true;
const _noFail: OnFail = warn;

export const pipeline: Runnable = {
	kind: "sequential",
	steps: [
		brainstorm, //  1️⃣  basic step
		challenge, //  2️⃣  assert gate + retry onFail
		expandParallel, //  3️⃣  parallel (concat merge)
		rankPool, //  4️⃣  pool ×3 (rank merge) + regex gate
		summarizeStep, //  5️⃣  summarize transform
		formatStep, //  6️⃣  JSON gate + extract transform
		warnDemo, //  7️⃣  warn onFail demo
		fallbackDemo, //  8️⃣  fallback onFail demo
		toolDemo, //  9️⃣  tool usage demo (bash)
		webSearchDemo, // 🔟  web search tool demo
		llmFastDemo, // 1️⃣1️⃣  llmFast gate demo
		retryDemo, // 1️⃣2️⃣  closure-counter retry demo
	],
	gate: noGate,
} satisfies Sequential;
