import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { FsPort } from "./core/ports.js";
import { CaptainState } from "./state.js";

// ── Fake FsPort ───────────────────────────────────────────────────────────

function makeFakeFs(
	initial: Record<string, string> = {},
): FsPort & { files: Map<string, string>; dirs: Set<string> } {
	const files = new Map(Object.entries(initial));
	const dirs = new Set<string>();

	return {
		files,
		dirs,
		exists: (p) => files.has(p) || dirs.has(p),
		readText: (p) => {
			const c = files.get(p);
			if (c === undefined) throw new Error(`FakeFs: not found: ${p}`);
			return c;
		},
		writeText: (p, c) => {
			files.set(p, c);
		},
		mkdirp: (p) => {
			dirs.add(p);
		},
		listFiles: (dir) => {
			const prefix = dir.endsWith("/") ? dir : `${dir}/`;
			return [...files.keys()]
				.filter(
					(k) => k.startsWith(prefix) && !k.slice(prefix.length).includes("/"),
				)
				.map((k) => k.slice(prefix.length));
		},
		remove: (p) => {
			files.delete(p);
		},
	};
}

// ── ensureCaptainContractFile ─────────────────────────────────────────────

describe("CaptainState: ensureCaptainContractFile", () => {
	test("creates .pi/pipelines/captain.ts when it does not exist", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/captain", fs);
		state.ensureCaptainContractFile("/cwd");
		const contractPath = join("/cwd", ".pi", "pipelines", "captain.ts");
		expect(fs.files.has(contractPath)).toBe(true);
	});

	test("written content exports from captainDir/api.ts", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/my/captain", fs);
		state.ensureCaptainContractFile("/cwd");
		const contractPath = join("/cwd", ".pi", "pipelines", "captain.ts");
		expect(fs.files.get(contractPath)).toContain("/my/captain/api.ts");
	});

	test("does not overwrite when content is already up to date", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/captain", fs);
		state.ensureCaptainContractFile("/cwd");
		const contractPath = join("/cwd", ".pi", "pipelines", "captain.ts");
		const first = fs.files.get(contractPath);

		// Mutate to simulate a stale write tracking, then call again
		state.ensureCaptainContractFile("/cwd");
		expect(fs.files.get(contractPath)).toBe(first);
	});

	test("overwrites when existing content is stale", () => {
		const contractPath = join("/cwd", ".pi", "pipelines", "captain.ts");
		const fs = makeFakeFs({ [contractPath]: "// old content" });
		const state = new CaptainState("/captain", fs);
		state.ensureCaptainContractFile("/cwd");
		expect(fs.files.get(contractPath)).not.toBe("// old content");
	});
});

// ── discoverPresets ───────────────────────────────────────────────────────

describe("CaptainState: discoverPresets", () => {
	test("returns empty array when .pi/pipelines does not exist", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/captain", fs);
		expect(state.discoverPresets("/cwd")).toEqual([]);
	});

	test("returns .ts files (excluding captain.ts)", () => {
		const dir = join("/cwd", ".pi", "pipelines");
		const fs = makeFakeFs({
			[`${dir}/my-pipe.ts`]: "",
			[`${dir}/captain.ts`]: "",
		});
		fs.dirs.add(dir);
		const state = new CaptainState("/captain", fs);
		const results = state.discoverPresets("/cwd");
		expect(results.map((r) => r.name)).toEqual(["my-pipe"]);
	});

	test("ignores .json files (only .ts pipelines are supported)", () => {
		const dir = join("/cwd", ".pi", "pipelines");
		const fs = makeFakeFs({ [`${dir}/pipeline.json`]: "" });
		fs.dirs.add(dir);
		const state = new CaptainState("/captain", fs);
		const results = state.discoverPresets("/cwd");
		expect(results).toEqual([]);
	});

	test("includes source path", () => {
		const dir = join("/cwd", ".pi", "pipelines");
		const fs = makeFakeFs({ [`${dir}/p.ts`]: "" });
		fs.dirs.add(dir);
		const state = new CaptainState("/captain", fs);
		const [result] = state.discoverPresets("/cwd");
		expect(result.source).toBe(join(dir, "p.ts"));
	});
});

// ── buildPipelineListLines ────────────────────────────────────────────────

describe("CaptainState: buildPipelineListLines", () => {
	test("returns loaded pipelines with (loaded) label", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/captain", fs);
		state.pipelines["my-pipe"] = {
			spec: { kind: "step", label: "x", prompt: "y" },
		};
		const lines = state.buildPipelineListLines();
		expect(lines[0]).toContain("my-pipe (loaded)");
	});

	test("returns empty array when no pipelines and no cwd", () => {
		const fs = makeFakeFs();
		const state = new CaptainState("/captain", fs);
		expect(state.buildPipelineListLines()).toEqual([]);
	});

	test("includes user pipelines from .pi/pipelines when cwd provided", () => {
		const dir = join("/cwd", ".pi", "pipelines");
		const fs = makeFakeFs({ [`${dir}/user-pipe.ts`]: "" });
		fs.dirs.add(dir);
		const state = new CaptainState("/captain", fs);
		const lines = state.buildPipelineListLines("/cwd");
		const flat = lines.join("\n");
		expect(flat).toContain("user-pipe");
	});

	test("does not list already-loaded pipelines in user section", () => {
		const dir = join("/cwd", ".pi", "pipelines");
		const fs = makeFakeFs({ [`${dir}/loaded-pipe.ts`]: "" });
		fs.dirs.add(dir);
		const state = new CaptainState("/captain", fs);
		state.pipelines["loaded-pipe"] = {
			spec: { kind: "step", label: "x", prompt: "y" },
		};
		const lines = state.buildPipelineListLines("/cwd");
		// should appear only once (in loaded section), not also in user section
		const flat = lines.join("\n");
		const count = (flat.match(/loaded-pipe/g) ?? []).length;
		expect(count).toBe(1);
	});
});
