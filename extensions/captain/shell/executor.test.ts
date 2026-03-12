// ── Executor Integration Tests ─────────────────────────────────────────────
// Mocks the pi SDK (createAgentSession) and worktree helpers so tests run
// without a real LLM or git repo. Covers sequential, parallel, pool execution
// paths, gate/onFail behaviour, $INPUT/$ORIGINAL interpolation, and transform.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { concat, firstPass } from "../core/merge.js";
import type { Parallel, Pool, Sequential, Step } from "../core/types.js";
import { skip, warn } from "../gates/on-fail.js";
import { extract, full } from "../transforms/presets.js";
import type { ExecutorContext } from "./executor.js";

// ── Shared mutable session config ──────────────────────────────────────────
// All mock sessions read from this object so individual tests can customise
// output / prompt capture without re-declaring mock.module.

const sessionCfg = {
	output: "step output",
	promptsSeen: [] as string[],
};

function resetSessionCfg(output = "step output") {
	sessionCfg.output = output;
	sessionCfg.promptsSeen = [];
}

// ── Module mocks ───────────────────────────────────────────────────────────

mock.module("@mariozechner/pi-coding-agent", () => ({
	createAgentSession: async () => ({
		session: {
			subscribe: (fn: (e: unknown) => void) => {
				fn({
					type: "message_update",
					assistantMessageEvent: {
						type: "text_delta",
						delta: sessionCfg.output,
					},
				});
				return () => {
					/* unsubscribe noop */
				};
			},
			prompt: async (p: string) => {
				sessionCfg.promptsSeen.push(p);
			},
			abort: () => {
				/* test stub */
			},
			dispose: () => {
				/* test stub */
			},
			setActiveToolsByName: () => {
				/* test stub */
			},
		},
	}),
	createReadTool: () => ({ name: "read" }),
	createBashTool: () => ({ name: "bash" }),
	createEditTool: () => ({ name: "edit" }),
	createWriteTool: () => ({ name: "write" }),
	createGrepTool: () => ({ name: "grep" }),
	createFindTool: () => ({ name: "find" }),
	createLsTool: () => ({ name: "ls" }),
	getAgentDir: () => "/fake/agent-dir",
	DefaultResourceLoader: class {
		async reload() {
			/* test stub */
		}
	},
	SessionManager: { inMemory: () => ({}) },
	SettingsManager: { inMemory: () => ({}) },
}));

// Worktree: always return null (no git repo needed)
mock.module("../infra/worktree.js", () => ({
	createWorktree: async () => null,
	removeWorktree: async () => {
		/* test stub */
	},
	commitWorktreeChanges: async () => false,
	isGitRepo: async () => false,
}));

// ── Import executor AFTER mocks are declared ───────────────────────────────
const { executeRunnable } = await import("./executor.js");

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeStep(label: string, prompt = "do $INPUT"): Step {
	return {
		kind: "step",
		label,
		prompt,
		onFail: skip,
		transform: full,
	};
}

function makeExec(code = 0, stdout = "", stderr = "") {
	return mock(
		async (_cmd: string, _args: readonly string[], _opts?: unknown) =>
			({ code, stdout, stderr }) as {
				code: number;
				stdout: string;
				stderr: string;
			},
	);
}

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
	const fakeModel = {
		id: "test-model",
		provider: "test",
	} as ExecutorContext["model"];
	return {
		exec: makeExec(),
		model: fakeModel,
		modelRegistry: {
			getAll: () => [],
			find: () => undefined,
			getApiKey: async () => undefined,
		},
		apiKey: "test-key",
		cwd: "/tmp",
		hasUI: false,
		pipelineName: "test-pipeline",
		...overrides,
	};
}

// ── Step execution ─────────────────────────────────────────────────────────

describe("executeRunnable: step", () => {
	beforeEach(() => resetSessionCfg());

	test("runs a step and returns output", async () => {
		resetSessionCfg("hello from agent");
		const { output, results } = await executeRunnable(
			makeStep("greet"),
			"world",
			"world",
			makeCtx(),
		);
		expect(output).toBe("hello from agent");
		expect(results).toHaveLength(1);
		expect(results[0].label).toBe("greet");
		expect(results[0].status).toBe("passed");
	});

	test("interpolates $INPUT and $ORIGINAL in prompt", async () => {
		const step = makeStep("interp", "INPUT=$INPUT ORIG=$ORIGINAL");
		await executeRunnable(step, "my-input", "my-original", makeCtx());
		expect(sessionCfg.promptsSeen[0]).toContain("INPUT=my-input");
		expect(sessionCfg.promptsSeen[0]).toContain("ORIG=my-original");
	});

	test("records elapsed time", async () => {
		const { results } = await executeRunnable(
			makeStep("timer"),
			"",
			"",
			makeCtx(),
		);
		expect(results[0].elapsed).toBeGreaterThanOrEqual(0);
	});

	test("step with failing gate + skip onFail → skipped, output empty", async () => {
		resetSessionCfg("output without keyword");
		const step: Step = {
			...makeStep("gated"),
			gate: ({ output }) =>
				output.includes("REQUIRED") ? true : "Missing REQUIRED in output",
			onFail: skip,
		};
		const { output, results } = await executeRunnable(step, "", "", makeCtx());
		expect(output).toBe("");
		expect(results[0].status).toBe("skipped");
	});

	test("step with failing gate + warn onFail → passes with warning", async () => {
		resetSessionCfg("output without keyword");
		const step: Step = {
			...makeStep("warned"),
			gate: ({ output }) =>
				output.includes("REQUIRED") ? true : "Missing REQUIRED in output",
			onFail: warn,
		};
		const { output, results } = await executeRunnable(step, "", "", makeCtx());
		expect(output).toBe("output without keyword"); // warn keeps output
		expect(results[0].status).toBe("passed");
		expect(results[0].error).toContain("Warning");
	});

	test("cancelled signal returns early", async () => {
		const ac = new AbortController();
		ac.abort();
		const { output } = await executeRunnable(
			makeStep("cancelled"),
			"",
			"",
			makeCtx({ signal: ac.signal }),
		);
		expect(output).toBe("(cancelled)");
	});
});

// ── Transform ──────────────────────────────────────────────────────────────

describe("executeRunnable: transform", () => {
	test("full transform returns output as-is", async () => {
		resetSessionCfg("raw output");
		const step: Step = { ...makeStep("t"), transform: full };
		const { output } = await executeRunnable(step, "", "", makeCtx());
		expect(output).toBe("raw output");
	});

	test("extract transform pulls key from JSON output", async () => {
		resetSessionCfg('{"name":"Alice","age":30}');
		const step: Step = {
			...makeStep("t"),
			transform: extract("name"),
		};
		const { output } = await executeRunnable(step, "", "", makeCtx());
		expect(output).toBe("Alice");
	});

	test("extract transform falls back to raw output on invalid JSON", async () => {
		resetSessionCfg("not json");
		const step: Step = {
			...makeStep("t"),
			transform: extract("name"),
		};
		const { output } = await executeRunnable(step, "", "", makeCtx());
		expect(output).toBe("not json");
	});
});

// ── Sequential ─────────────────────────────────────────────────────────────

describe("executeRunnable: sequential", () => {
	test("chains output of each step as input to the next", async () => {
		// Each step returns its call-number as output; track via counter
		let n = 0;
		const outputs = ["out-1", "out-2", "out-3"];
		// Override per-call: mock.module persists, but we can mutate sessionCfg
		// before each call using a custom session that reads from an index
		const origOutput = sessionCfg.output;
		// We can't intercept between steps with a single shared var because steps
		// run sequentially — advance the output after each call by using a counter
		// embedded in the prompt-capture
		const callOutputs = outputs;
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => {
				const out = callOutputs[n++ % callOutputs.length];
				return {
					session: {
						subscribe: (fn: (e: unknown) => void) => {
							fn({
								type: "message_update",
								assistantMessageEvent: {
									type: "text_delta",
									delta: out ?? "x",
								},
							});
							return () => {
								/* unsubscribe noop */
							};
						},
						prompt: async (p: string) => {
							sessionCfg.promptsSeen.push(p);
						},
						abort: () => {
							/* test stub */
						},
						dispose: () => {
							/* test stub */
						},

						setActiveToolsByName: () => {
							/* test stub */
						},
					},
				};
			},
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: seqExecute } = await import("./executor.js");
		sessionCfg.promptsSeen = [];
		n = 0;

		const seq: Sequential = {
			kind: "sequential",
			steps: [
				makeStep("step-1", "$INPUT-done"),
				makeStep("step-2", "$INPUT-done"),
				makeStep("step-3", "$INPUT-done"),
			],
		};

		const { output, results } = await seqExecute(
			seq,
			"start",
			"start",
			makeCtx(),
		);
		expect(output).toBe("out-3");
		expect(results).toHaveLength(3);
		// Step 2 receives step 1's output as $INPUT
		expect(sessionCfg.promptsSeen[1]).toContain("out-1-done");
		// Step 3 receives step 2's output as $INPUT
		expect(sessionCfg.promptsSeen[2]).toContain("out-2-done");

		// Restore original mock
		sessionCfg.output = origOutput;
	});

	test("stops when a step status is failed (not just skipped)", async () => {
		// To get status "failed" we need the step to throw, not just skip.
		// Make createAgentSession throw to trigger a failed status.
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => {
				throw new Error("simulated session error");
			},
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: seqExecute } = await import("./executor.js");

		const seq: Sequential = {
			kind: "sequential",
			steps: [
				// Step 1: session throws → status "failed"
				makeStep("step-1"),
				// Step 2: should NOT run
				makeStep("step-2"),
			],
		};

		const { results } = await seqExecute(seq, "", "", makeCtx());
		expect(results).toHaveLength(1);
		expect(results[0].status).toBe("failed");
	});

	test("collects results from all passing steps", async () => {
		let n = 0;
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: `out-${++n}`,
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: seqExecute } = await import("./executor.js");
		n = 0;

		const seq: Sequential = {
			kind: "sequential",
			steps: [makeStep("a"), makeStep("b"), makeStep("c")],
		};

		const { results } = await seqExecute(seq, "", "", makeCtx());
		expect(results).toHaveLength(3);
		expect(results.map((r) => r.label)).toEqual(["a", "b", "c"]);
	});

	test("container-level gate: skip onFail empties output", async () => {
		resetSessionCfg("plain result");
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: sessionCfg.output,
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: seqExecute } = await import("./executor.js");

		const seq: Sequential = {
			kind: "sequential",
			steps: [makeStep("a")],
			gate: ({ output }) =>
				output.includes("REQUIRED") ? true : "Missing REQUIRED in output",
			onFail: skip,
		};

		const { output } = await seqExecute(seq, "", "", makeCtx());
		expect(output).toBe("");
	});

	test("container-level gate: warn onFail keeps output", async () => {
		resetSessionCfg("plain result");
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: sessionCfg.output,
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: seqExecute } = await import("./executor.js");

		const seq: Sequential = {
			kind: "sequential",
			steps: [makeStep("a")],
			gate: ({ output }) =>
				output.includes("REQUIRED") ? true : "Missing REQUIRED in output",
			onFail: warn,
		};

		const { output } = await seqExecute(seq, "", "", makeCtx());
		expect(output).toBe("plain result");
	});
});

// ── Parallel ───────────────────────────────────────────────────────────────

describe("executeRunnable: parallel", () => {
	test("runs all branches and merges with concat", async () => {
		let n = 0;
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: `branch-${++n}`,
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: parExecute } = await import("./executor.js");
		n = 0;

		const par: Parallel = {
			kind: "parallel",
			steps: [makeStep("a"), makeStep("b"), makeStep("c")],
			merge: concat,
		};

		const { output, results } = await parExecute(
			par,
			"input",
			"orig",
			makeCtx(),
		);
		expect(results).toHaveLength(3);
		expect(results.map((r) => r.label).sort()).toEqual(["a", "b", "c"]);
		expect(output).toContain("Branch 1");
		expect(output).toContain("Branch 2");
		expect(output).toContain("Branch 3");
	});

	test("firstPass returns first non-empty branch output", async () => {
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: "branch-result",
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: parExecute } = await import("./executor.js");

		const par: Parallel = {
			kind: "parallel",
			steps: [makeStep("a"), makeStep("b")],
			merge: firstPass,
		};

		const { output } = await parExecute(par, "", "", makeCtx());
		expect(output).toBe("branch-result");
	});

	test("all branches receive same $INPUT (not chained)", async () => {
		const prompts: string[] = [];
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "ok" },
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async (p: string) => {
						prompts.push(p);
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: parExecute } = await import("./executor.js");

		const par: Parallel = {
			kind: "parallel",
			steps: [makeStep("a", "prompt: $INPUT"), makeStep("b", "prompt: $INPUT")],
			merge: concat,
		};

		await parExecute(par, "shared-input", "orig", makeCtx());
		expect(prompts.every((p) => p.includes("shared-input"))).toBe(true);
	});
});

// ── Pool ───────────────────────────────────────────────────────────────────

describe("executeRunnable: pool", () => {
	test("runs step N times and concatenates results", async () => {
		let n = 0;
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: `worker-${++n}`,
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: poolExecute } = await import("./executor.js");
		n = 0;

		const pool: Pool = {
			kind: "pool",
			step: makeStep("worker"),
			count: 3,
			merge: concat,
		};

		const { output, results } = await poolExecute(
			pool,
			"task",
			"task",
			makeCtx(),
		);
		expect(results).toHaveLength(3);
		expect(output).toContain("Branch 1");
		expect(output).toContain("Branch 2");
		expect(output).toContain("Branch 3");
	});

	test("each pool branch receives [Branch N of M] suffix in input", async () => {
		const prompts: string[] = [];
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "done" },
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async (p: string) => {
						prompts.push(p);
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: poolExecute } = await import("./executor.js");

		const pool: Pool = {
			kind: "pool",
			step: makeStep("worker", "$INPUT"),
			count: 2,
			merge: concat,
		};

		await poolExecute(pool, "my-task", "orig", makeCtx());
		expect(prompts.some((p) => p.includes("Branch 1 of 2"))).toBe(true);
		expect(prompts.some((p) => p.includes("Branch 2 of 2"))).toBe(true);
	});

	test("pool count=1 returns single worker output", async () => {
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: {
								type: "text_delta",
								delta: "solo-result",
							},
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: poolExecute } = await import("./executor.js");

		const pool: Pool = {
			kind: "pool",
			step: makeStep("solo"),
			count: 1,
			merge: firstPass,
		};

		const { output } = await poolExecute(pool, "", "", makeCtx());
		expect(output).toBe("solo-result");
	});
});

// ── Lifecycle callbacks ────────────────────────────────────────────────────

describe("executeRunnable: lifecycle callbacks", () => {
	test("onStepStart and onStepEnd are called for each step", async () => {
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						fn({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "ok" },
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: cbExecute } = await import("./executor.js");

		const started: string[] = [];
		const ended: string[] = [];

		const ctx = makeCtx({
			onStepStart: (label) => started.push(label),
			onStepEnd: (result) => ended.push(result.label),
		});

		const seq: Sequential = {
			kind: "sequential",
			steps: [makeStep("alpha"), makeStep("beta")],
		};

		await cbExecute(seq, "", "", ctx);
		expect(started).toEqual(["alpha", "beta"]);
		expect(ended).toEqual(["alpha", "beta"]);
	});

	test("onStepStream receives incremental output deltas", async () => {
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async () => ({
				session: {
					subscribe: (fn: (e: unknown) => void) => {
						// Two deltas
						fn({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "hello " },
						});
						fn({
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "world" },
						});
						return () => {
							/* unsubscribe noop */
						};
					},
					prompt: async () => {
						/* test stub */
					},
					abort: () => {
						/* test stub */
					},
					dispose: () => {
						/* test stub */
					},

					setActiveToolsByName: () => {
						/* test stub */
					},
				},
			}),
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: () => ({ name: "write" }),
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		const { executeRunnable: streamExecute } = await import("./executor.js");

		const streamed: string[] = [];
		const ctx = makeCtx({
			onStepStream: (_label, text) => streamed.push(text),
		});

		await streamExecute(makeStep("stream-test"), "", "", ctx);
		expect(streamed).toContain("hello ");
		expect(streamed).toContain("hello world");
	});
});

// ── Worktree cwd isolation ─────────────────────────────────────────────────
// When createWorktree succeeds, every session and every tool created inside
// that branch MUST use the worktree path — never the caller's original cwd.

describe("worktree cwd isolation", () => {
	function makeWorktreeMock(sessionCwds: string[], writeCwds: string[]) {
		mock.module("@mariozechner/pi-coding-agent", () => ({
			createAgentSession: async (opts: { cwd?: string }) => {
				sessionCwds.push(opts?.cwd ?? "(none)");
				return {
					session: {
						subscribe: (fn: (e: unknown) => void) => {
							fn({
								type: "message_update",
								assistantMessageEvent: { type: "text_delta", delta: "ok" },
							});
							return () => {
								/* unsubscribe noop */
							};
						},
						prompt: async () => {
							/* test stub */
						},
						abort: () => {
							/* test stub */
						},
						dispose: () => {
							/* test stub */
						},
						setActiveToolsByName: () => {
							/* test stub */
						},
					},
				};
			},
			createReadTool: () => ({ name: "read" }),
			createBashTool: () => ({ name: "bash" }),
			createEditTool: () => ({ name: "edit" }),
			createWriteTool: (cwd: string) => {
				writeCwds.push(cwd);
				return { name: "write" };
			},
			createGrepTool: () => ({ name: "grep" }),
			createFindTool: () => ({ name: "find" }),
			createLsTool: () => ({ name: "ls" }),
			getAgentDir: () => "/fake/agent-dir",
			DefaultResourceLoader: class {
				async reload() {
					/* test stub */
				}
			},
			SessionManager: { inMemory: () => ({}) },
			SettingsManager: { inMemory: () => ({}) },
		}));

		mock.module("../infra/worktree.js", () => ({
			isGitRepo: async () => true,
			createWorktree: async (
				_exec: unknown,
				_cwd: string,
				_name: string,
				_label: string,
				i: number,
			) => ({
				worktreePath: `/fake-worktrees/branch-${i}`,
				branchName: `captain/branch-${i}`,
			}),
			removeWorktree: async () => {
				/* test stub */
			},
			commitWorktreeChanges: async () => false,
		}));
	}

	test("parallel: createAgentSession receives worktree cwd, not main cwd", async () => {
		const sessionCwds: string[] = [];
		const writeCwds: string[] = [];
		makeWorktreeMock(sessionCwds, writeCwds);

		const { executeRunnable: parExec } = await import("./executor.js");

		const par: Parallel = {
			kind: "parallel",
			steps: [makeStep("a"), makeStep("b")],
			merge: concat,
		};

		await parExec(par, "input", "orig", makeCtx({ cwd: "/main" }));

		// Each branch must use its own worktree cwd
		expect(sessionCwds).toHaveLength(2);
		expect(sessionCwds.every((c) => c.startsWith("/fake-worktrees/"))).toBe(
			true,
		);
		// The main cwd must never appear
		expect(sessionCwds.includes("/main")).toBe(false);
	});

	test("parallel: write tool is created with worktree cwd, not main cwd", async () => {
		const sessionCwds: string[] = [];
		const writeCwds: string[] = [];
		makeWorktreeMock(sessionCwds, writeCwds);

		const { executeRunnable: parExec } = await import("./executor.js");

		const par: Parallel = {
			kind: "parallel",
			steps: [makeStep("a"), makeStep("b")],
			merge: concat,
		};

		await parExec(par, "input", "orig", makeCtx({ cwd: "/main" }));

		expect(writeCwds).toHaveLength(2);
		expect(writeCwds.every((c) => c.startsWith("/fake-worktrees/"))).toBe(true);
		expect(writeCwds.includes("/main")).toBe(false);
	});

	test("pool: createAgentSession receives worktree cwd, not main cwd", async () => {
		const sessionCwds: string[] = [];
		const writeCwds: string[] = [];
		makeWorktreeMock(sessionCwds, writeCwds);

		const { executeRunnable: poolExec } = await import("./executor.js");

		const pool: Pool = {
			kind: "pool",
			step: makeStep("worker"),
			count: 2,
			merge: concat,
		};

		await poolExec(pool, "task", "orig", makeCtx({ cwd: "/main" }));

		expect(sessionCwds).toHaveLength(2);
		expect(sessionCwds.every((c) => c.startsWith("/fake-worktrees/"))).toBe(
			true,
		);
		expect(sessionCwds.includes("/main")).toBe(false);
	});

	test("pool: write tool is created with worktree cwd, not main cwd", async () => {
		const sessionCwds: string[] = [];
		const writeCwds: string[] = [];
		makeWorktreeMock(sessionCwds, writeCwds);

		const { executeRunnable: poolExec } = await import("./executor.js");

		const pool: Pool = {
			kind: "pool",
			step: makeStep("worker"),
			count: 2,
			merge: concat,
		};

		await poolExec(pool, "task", "orig", makeCtx({ cwd: "/main" }));

		expect(writeCwds).toHaveLength(2);
		expect(writeCwds.every((c) => c.startsWith("/fake-worktrees/"))).toBe(true);
		expect(writeCwds.includes("/main")).toBe(false);
	});
});
