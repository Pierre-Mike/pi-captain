// ── Pipeline Registry — re-exports all built-in pipeline presets ──────────
// Add new pipelines as separate .ts files in this folder and export them here.
// Each pipeline module exports: { agents, pipeline }

export * as apiDesign from "./api-design.js";
// ── New pipelines ────────────────────────────────────────────────────────
export * as bugHunt from "./bug-hunt.js";
export * as documentationGen from "./documentation-gen.js";
export * as fullFeatureBuild from "./full-feature-build.js";
export * as gatedFeatureBuild from "./gated-feature-build.js";
export * as migrationPlanner from "./migration-planner.js";
export * as prReview from "./pr-review.js";
export * as refactorAndVerify from "./refactor-and-verify.js";
// ── Original pipelines ───────────────────────────────────────────────────
export * as researchAndSummarize from "./research-and-summarize.js";
export * as securityAudit from "./security-audit.js";
export * as shredder from "./shredder.js";
export * as testCoverageBoost from "./test-coverage-boost.js";
