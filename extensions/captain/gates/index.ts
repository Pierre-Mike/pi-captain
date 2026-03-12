// Public gate API barrel — re-exports core + preset gates.
export type { GateResult } from "../core/gate-runner.js";
export { runGate } from "../core/gate-runner.js";
export { llmFast } from "./llm.js";
export { fallback, retry, retryWithDelay, skip, warn } from "./on-fail.js";
export { allOf, bunTest, command, file, regexCI, user } from "./presets.js";
