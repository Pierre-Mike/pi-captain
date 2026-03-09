// ── OnFail Presets — reusable failure handling strategies ─────────────────
// Each preset is an OnFail function: (ctx: OnFailCtx) => OnFailResult
// Factories are allowed — they must return a proper OnFail, not leak config into the result.
// Write your own inline for custom behaviour — it's just a function.

import type { OnFail, Step } from "../types.js";

// ── Presets ───────────────────────────────────────────────────────────────

/** Retry the step up to `max` times (default 3), then fail */
export function retry(max = 3): OnFail {
	return ({ retryCount }) =>
		retryCount < max ? { action: "retry" } : { action: "fail" };
}

/** Retry the step after `delayMs` milliseconds, up to `max` times */
export function retryWithDelay(max = 3, delayMs: number): OnFail {
	return async ({ retryCount }) => {
		if (retryCount >= max) return { action: "fail" };
		await new Promise((r) => setTimeout(r, delayMs));
		return { action: "retry" };
	};
}

/** Run an alternative step when the scope fails */
export function fallback(step: Step): OnFail {
	return () => ({ action: "fallback", step });
}

/** Skip the scope — mark as skipped and continue with empty output */
export const skip: OnFail = () => ({ action: "skip" });

/** Log a warning but treat as passed and continue */
export const warn: OnFail = () => ({ action: "warn" });
