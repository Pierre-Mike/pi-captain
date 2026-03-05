// ── Steps Registry — re-exports all pipeline steps ───────────────────────
// Each step is an atomic unit that can be composed into pipelines.

// ── Refactor & Verify steps ──────────────────────────────────────────────
export { analyzeCodebase } from "./analyze-codebase.js";
// ── API Design steps ─────────────────────────────────────────────────────
export { apiDesignStep } from "./api-design-step.js";
export { apiDocs } from "./api-docs.js";
export { apiImplementation } from "./api-implementation.js";
// ── Documentation Generation steps ──────────────────────────────────────
export { architectureDocs } from "./architecture-docs.js";
// ── Original steps ────────────────────────────────────────────────────────
export { architecturePlan } from "./architecture-plan.js";
// ── Migration Planner steps ──────────────────────────────────────────────
export { auditDependencies } from "./audit-dependencies.js";
export { authReview } from "./auth-review.js";
export { backendImplementation } from "./backend-implementation.js";
export { codeReview } from "./code-review.js";
// ── Test Coverage Boost steps ────────────────────────────────────────────
export { coverageAnalysis } from "./coverage-analysis.js";
// ── Security Audit steps ─────────────────────────────────────────────────
export { dependencyScan } from "./dependency-scan.js";
export { diagnoseBug } from "./diagnose-bug.js";
export { docsReview } from "./docs-review.js";
export { edgeCaseGen } from "./edge-case-gen.js";
export { fixBug } from "./fix-bug.js";
export { frontendImplementation } from "./frontend-implementation.js";
export { integrationTests } from "./integration-tests.js";
export { migrationStrategy } from "./migration-strategy.js";
export { owaspCheck } from "./owasp-check.js";
export { performanceReview } from "./performance-review.js";
export { qualityReview } from "./quality-review.js";
export { redTeamAssessment } from "./red-team-assessment.js";
export { refactorCode } from "./refactor-code.js";
// ── Bug Hunt steps ────────────────────────────────────────────────────────
export { reproduceBug } from "./reproduce-bug.js";
export { research } from "./research.js";
export { riskAssessment } from "./risk-assessment.js";
export { secretScan } from "./secret-scan.js";
// ── PR Review steps ──────────────────────────────────────────────────────
export { securityAuditStep } from "./security-audit-step.js";
export { securityReport } from "./security-report.js";
export { summarize } from "./summarize.js";
export { synthesizeReview } from "./synthesize-review.js";
export { testStrategy } from "./test-strategy.js";
export { unitTestGen } from "./unit-test-gen.js";
export { usageGuide } from "./usage-guide.js";
export { verifyFix } from "./verify-fix.js";
export { writeRegressionTests } from "./write-regression-tests.js";
