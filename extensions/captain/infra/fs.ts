// ── infra/fs.ts — Filesystem Adapter (implements FsPort) ──────────────────
// All direct node:fs calls live here. Nothing else in the codebase should
// import from "node:fs" — import this adapter and call through the interface.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import type { FsPort } from "../ports.js";

/** The real filesystem adapter — used in production. */
export const realFs: FsPort = {
	exists: (path: string) => existsSync(path),

	readText: (path: string) => readFileSync(path, "utf-8"),

	writeText: (path: string, content: string) =>
		writeFileSync(path, content, "utf-8"),

	mkdirp: (path: string) => mkdirSync(path, { recursive: true }),

	listFiles: (dir: string) => readdirSync(dir),

	remove: (path: string) => unlinkSync(path),
};
