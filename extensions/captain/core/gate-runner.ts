// ── core/gate-runner.ts — Pure gate evaluation (no I/O) ───────────────────
// A gate is: ({ output, ctx? }) => true | string | Promise<true | string>
//   true   → passed
//   string → failed — the string IS the reason
//   throw  → failed — error.message becomes the reason

import { err, ok, type Result } from "neverthrow";
import type { Gate, GateCtx } from "../types.js";

export interface GateResult {
	readonly passed: boolean;
	readonly reason: string;
}

/** Map a raw gate return value to a typed Result. */
function gateReturnToResult(value: true | string): Result<void, string> {
	return value === true ? ok(undefined) : err(value);
}

/** Wrap any thrown value into a string error. */
function caughtToString(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

/**
 * Run a gate and return a structured { passed, reason } result.
 * Uses Result<void, string> internally — no exceptions escape this function.
 */
export async function runGate(
	gate: Gate,
	output: string,
	ctx?: GateCtx,
): Promise<GateResult> {
	const result = await (async () => {
		try {
			const raw = await gate({ output, ctx });
			return gateReturnToResult(raw);
		} catch (e) {
			return err(caughtToString(e));
		}
	})();

	return result.match(
		() => ({ passed: true, reason: "passed" }),
		(reason) => ({ passed: false, reason }),
	);
}
