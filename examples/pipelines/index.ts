// ── Pipeline Registry — re-exports all built-in pipeline presets ──────────
// Personal pipelines are stored as JSON in ~/.pi/pipelines/ (loaded at runtime).
// Only the shredder pipeline ships with the repo.
//
// Note: research-swarm-phases-a.ts and research-swarm-phases-b.ts are internal
// helper modules used by research-swarm.ts, not standalone pipelines.

export * as githubPrReview from "./github-pr-review.js";
export * as reqDecompose from "./req-decompose.js";
export * as reqDecomposeAi from "./req-decompose-ai.js";
export * as requirementsGathering from "./requirements-gathering.js";
export * as researchSwarm from "./research-swarm.js";
export * as showcase from "./showcase.js";
export * as shredder from "./shredder.js";
export * as specTdd from "./spec-tdd.js";
