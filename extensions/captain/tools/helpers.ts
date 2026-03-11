import type { TextContent } from "@mariozechner/pi-ai";

/** Wrap a plain string in the TextContent shape expected by tool return values. */
export function text(t: string): TextContent {
	return { type: "text" as const, text: t };
}
