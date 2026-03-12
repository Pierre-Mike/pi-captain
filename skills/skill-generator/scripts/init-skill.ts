#!/usr/bin/env bun
/**
 * Scaffold a new skill directory with TODO-filled templates.
 *
 * Usage:
 *   bun scripts/init-skill.ts <skill-name> [--output <dir>]
 *
 * Examples:
 *   bun scripts/init-skill.ts api-validator
 *   bun scripts/init-skill.ts api-validator --output ./generated/skills
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const SKILL_MD_TEMPLATE = `---
name: [SKILL_NAME]
description: >
  [TODO: Write a 100+ word description. Include what the skill does,
  specific trigger scenarios, and "Use when" phrasing. Example:
  "Comprehensive API validation for REST endpoints with support for
  schema checking, response format verification, and error handling
  patterns. Use when working with API responses for: (1) Validating
  response shapes against schemas, (2) Checking error response formats,
  (3) Testing endpoint behavior, or any API quality task."]
---

# [SKILL_TITLE]

## Core Concepts

**[TODO: First concept title]**: [TODO: Explanation of why this matters.
Include a code example if the concept is technical.]

**[TODO: Second concept title]**: [TODO: Explanation. Keep to 2-3 core
concepts that are always relevant when this skill activates.]

## Quick Patterns

1. **[TODO: Step name]** -- [What to do and why]
2. **[TODO: Step name]** -- [What to do and why]
3. **[TODO: Step name]** -- [What to do and why]

## Reference Files

Consult these only when you need specific details:

- \`rules/[TODO: rule-name].md\` -- when you need to [specific scenario]
`;

const METADATA_TEMPLATE = `{
  "triggers": [
    "[TODO: First trigger - describe a specific scenario in 100+ words]",
    "[TODO: Second trigger - describe another scenario in 100+ words]"
  ]
}
`;

const RULE_TEMPLATE = `# Rule Title Here

Brief explanation of the rule and why it matters. Focus on the "why" so the reader understands the reasoning.

## Avoid

\`\`\`
// Example of what not to do
const bad = example();
\`\`\`

## Prefer

\`\`\`
// Example of the correct approach
const good = example();
\`\`\`
`;

function toTitleCase(name: string): string {
	return name
		.split("-")
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help") {
		console.log(
			"Usage: bun scripts/init-skill.ts <skill-name> [--output <dir>]",
		);
		console.log("");
		console.log("Options:");
		console.log(
			"  --output <dir>  Output directory (default: current directory)",
		);
		console.log("");
		console.log("Examples:");
		console.log("  bun scripts/init-skill.ts api-validator");
		console.log("  bun scripts/init-skill.ts api-validator --output ./skills");
		process.exit(1);
	}

	const skillName = args[0];
	const outputIdx = args.indexOf("--output");
	const outputDir =
		outputIdx !== -1 && args[outputIdx + 1] ? args[outputIdx + 1] : ".";

	// Validate skill name
	if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skillName)) {
		console.error(
			`Error: Skill name "${skillName}" must be kebab-case (lowercase letters, digits, hyphens).`,
		);
		process.exit(1);
	}

	if (skillName.length > 64) {
		console.error(`Error: Skill name exceeds 64 characters.`);
		process.exit(1);
	}

	const skillDir = resolve(outputDir, skillName);

	if (existsSync(skillDir)) {
		console.error(`Error: Directory already exists: ${skillDir}`);
		process.exit(1);
	}

	const title = toTitleCase(skillName);

	// Create directory structure
	mkdirSync(join(skillDir, "rules"), { recursive: true });

	// Write SKILL.md
	const skillMd = SKILL_MD_TEMPLATE.replace(
		/\[SKILL_NAME\]/g,
		skillName,
	).replace(/\[SKILL_TITLE\]/g, title);
	writeFileSync(join(skillDir, "SKILL.md"), skillMd);

	// Write metadata.json
	writeFileSync(join(skillDir, "metadata.json"), METADATA_TEMPLATE);

	// Write rules/_template.md
	writeFileSync(join(skillDir, "rules", "_template.md"), RULE_TEMPLATE);

	console.log(`Initialized skill "${skillName}" at ${skillDir}`);
	console.log("");
	console.log("Created:");
	console.log(`  ${skillDir}/SKILL.md`);
	console.log(`  ${skillDir}/metadata.json`);
	console.log(`  ${skillDir}/rules/_template.md`);
	console.log("");
	console.log("Next steps:");
	console.log("  1. Fill in [TODO:] markers in SKILL.md");
	console.log("  2. Write trigger descriptions in metadata.json");
	console.log("  3. Add rule files to rules/");
}

main();
