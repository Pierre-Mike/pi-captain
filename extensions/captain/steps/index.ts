// ── Steps Registry — re-exports all pipeline steps ───────────────────────
// Each step is an atomic unit that can be composed into pipelines.

// ── Refactor & Analyze steps ─────────────────────────────────────────────
export { analyzeCodebase } from "./analyze-codebase.js";
// ── Req-Decompose steps ───────────────────────────────────────────────────
export { bddScenarios } from "./bdd-scenarios.js";
// ── Shredder steps ───────────────────────────────────────────────────────
export { captureAndClarify } from "./capture-and-clarify.js";
export { challengeRequirements } from "./challenge-requirements.js";
export { contractTasks } from "./contract-tasks.js";
export { decompose } from "./decompose.js";
export { deepDiveRequirements } from "./deep-dive-requirements.js";
export { diagnoseBug } from "./diagnose-bug.js";
export { earsStructure } from "./ears-structure.js";
// ── Adversarial testing ──────────────────────────────────────────────────
export { edgeCaseGen } from "./edge-case-gen.js";
// ── Requirements Gathering steps ─────────────────────────────────────────
export { exploreRequirements } from "./explore-requirements.js";
export { fetchPrFiles } from "./fetch-pr-files.js";
export { fetchPrMetadataAuthCheck } from "./fetch-pr-metadata-auth-check.js";
export { fetchPrMetadataAuthFailure } from "./fetch-pr-metadata-auth-failure.js";
export { fetchPrMetadataEmit } from "./fetch-pr-metadata-emit.js";
export { fetchPrMetadataGhCall } from "./fetch-pr-metadata-gh-call.js";
export { fixBug } from "./fix-bug.js";
export { fixReviewIssues } from "./fix-review-issues.js";
export { formatBacklog } from "./format-backlog.js";
export { formatTree } from "./format-tree.js";
export { generateExecutionSpec } from "./generate-execution-spec.js";
export { parsePrInput } from "./parse-pr-input.js";
export { preparePR } from "./prepare-pr.js";
export { reShred } from "./re-shred.js";
export { refactorCode } from "./refactor-code.js";
export { renderCanvas } from "./render-canvas.js";
// ── Bug Hunt steps ────────────────────────────────────────────────────────
export { reproduceBug } from "./reproduce-bug.js";
// ── Research steps ───────────────────────────────────────────────────────
export { research } from "./research.js";
export { resolveDependencies } from "./resolve-dependencies.js";
export { reviewCode } from "./review-code.js";
export { reviewPrFile } from "./review-pr-file.js";
export { shredAndScore } from "./shred-and-score.js";
export { sliceStories } from "./slice-stories.js";
export { sliceStoriesAi } from "./slice-stories-ai.js";
export { summarize } from "./summarize.js";
export { synthesizePrVerdict } from "./synthesize-pr-verdict.js";
export { synthesizeRequirements } from "./synthesize-requirements.js";
export { tddGreen } from "./tdd-green.js";
export { tddRed } from "./tdd-red.js";
export { tddTaskList } from "./tdd-task-list.js";
export { validateAtomicity } from "./validate-atomicity.js";
export { validateContracts } from "./validate-contracts.js";
export { validatePrInput } from "./validate-pr-input.js";
export { validateUnits } from "./validate-units.js";
export { verifyFix } from "./verify-fix.js";
export { writeDocs } from "./write-docs.js";
// ── Spec-Driven TDD steps ────────────────────────────────────────────────
export { writeSpec } from "./write-spec.js";
