// Re-export from core — kept for backwards compatibility with existing importers.
// New code should import directly from "./core/gate-runner.js".
export type { GateResult } from "./core/gate-runner.js";
export { runGate } from "./core/gate-runner.js";
