// ── OnFail Presets — reusable failure handling strategies ─────────────────
import type { OnFail, Step } from "../types.js";

/** Retry the scope up to N times (default 3) */
export function retry(max: number = 3): OnFail {
	return { action: "retry", max };
}

/** Retry with a delay between attempts — useful for flaky services or rate limits */
export function retryWithDelay(delayMs: number, max: number = 3): OnFail {
	return { action: "retryWithDelay", max, delayMs };
}

/** Skip the scope on failure — pass empty $INPUT downstream */
export const skip: OnFail = { action: "skip" };

/** Log a warning but pass through the output anyway — non-blocking gate */
export const warn: OnFail = { action: "warn" };

/** Run an alternative step when the scope fails */
export function fallback(step: Step): OnFail {
	return { action: "fallback", step };
}
