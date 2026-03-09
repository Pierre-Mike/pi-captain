// ── Step: Prepare PR ─────────────────────────────────────────────────────
// Stage 5 of spec-tdd: Creates a feature branch, stages changes selectively,
// writes a conventional commit, pushes, and optionally creates a GitHub PR.
// Gated on tests passing + human approval before push.

import { allOf, bunTest, retry, user } from "../gates/index.js";
import { full } from "../transforms/presets.js";
import type { Step } from "../types.js";

const prompt = `
You are the PR Preparer. Prepare a clean PR for the completed work.

Context from previous steps:
$INPUT

Original Requirement:
$ORIGINAL

Instructions:
1. Run \`bun test\` one final time to confirm everything passes
2. Run \`git status\` to see all changes
3. Create a feature branch:
   - Name format: \`feat/<short-description>\` or \`fix/<short-description>\`
   - Run: \`git checkout -b feat/<name>\`
4. Stage all relevant files (implementation + tests + docs):
   - Do NOT stage unrelated files
   - Use \`git add <specific-files>\` not \`git add .\`
5. Write a conventional commit message:
   \`\`\`
   feat: <short summary>

   <body explaining what and why>

   - <bullet points of changes>

   Closes #<issue> (if applicable)
   \`\`\`
6. Commit: \`git commit -m '<message>'\`
7. Push: \`git push -u origin <branch-name>\`
8. If \`gh\` CLI is available, create a PR:
   \`gh pr create --title '<title>' --body '<body>'\`

Report:
- BRANCH: <branch-name>
- COMMIT: <commit-hash>
- FILES COMMITTED: N
- PR CREATED: YES/NO (+ URL if yes)
`;

export const preparePR: Step = {
	kind: "step",
	label: "Prepare PR",
	tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
	temperature: 0.1,
	description:
		"Create a feature branch, stage changes, write a conventional commit, and push",
	prompt,
	// Gate: tests must pass + human must approve before push
	gate: allOf(bunTest, user),
	onFail: retry(1),
	transform: full,
	maxTurns: 10,
};
