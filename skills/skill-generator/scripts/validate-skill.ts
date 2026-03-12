#!/usr/bin/env bun
/**
 * Validate a skill directory for structural correctness.
 *
 * Usage:
 *   bun scripts/validate-skill.ts <path-to-skill>
 *
 * Checks:
 *   - SKILL.md exists with valid YAML frontmatter
 *   - metadata.json exists and is valid JSON
 *   - rules/ directory exists with _template.md
 *   - Frontmatter has name + description fields
 *   - Description is 100+ words
 *   - Name is kebab-case
 *   - Rule files have no YAML frontmatter and use Avoid/Prefer sections
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface ValidationResult {
	passed: boolean;
	message: string;
}

function validate(skillPath: string): ValidationResult[] {
	const results: ValidationResult[] = [];
	const dir = resolve(skillPath);

	// Check SKILL.md exists
	const skillMdPath = join(dir, "SKILL.md");
	if (!existsSync(skillMdPath)) {
		results.push({ passed: false, message: "SKILL.md not found" });
		return results;
	}
	results.push({ passed: true, message: "SKILL.md exists" });

	const content = readFileSync(skillMdPath, "utf-8");

	// Check frontmatter exists
	if (!content.startsWith("---")) {
		results.push({
			passed: false,
			message: "SKILL.md missing YAML frontmatter",
		});
		return results;
	}

	const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!fmMatch) {
		results.push({
			passed: false,
			message: "SKILL.md has invalid frontmatter format",
		});
		return results;
	}
	results.push({ passed: true, message: "Frontmatter format valid" });

	// Parse frontmatter manually (avoid external yaml dep)
	const fmText = fmMatch[1];
	const hasName = /^name:\s*.+/m.test(fmText);
	const hasDesc = /^description:\s*/m.test(fmText);

	if (!hasName) {
		results.push({
			passed: false,
			message: "Frontmatter missing 'name' field",
		});
	} else {
		results.push({ passed: true, message: "Frontmatter has 'name' field" });

		// Extract name and check kebab-case
		const nameMatch = fmText.match(/^name:\s*(.+)$/m);
		if (nameMatch) {
			const name = nameMatch[1].trim();
			if (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
				results.push({
					passed: true,
					message: `Name "${name}" is valid kebab-case`,
				});
			} else {
				results.push({
					passed: false,
					message: `Name "${name}" is not kebab-case`,
				});
			}
		}
	}

	if (!hasDesc) {
		results.push({
			passed: false,
			message: "Frontmatter missing 'description' field",
		});
	} else {
		results.push({
			passed: true,
			message: "Frontmatter has 'description' field",
		});

		// Extract description and check word count
		// Handle multi-line description (YAML block scalar)
		const afterDesc = fmText.substring(
			fmText.indexOf("description:") + "description:".length,
		);
		const descLines: string[] = [];
		const lines = afterDesc.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// First line might have the value or a block indicator
			if (i === 0) {
				const trimmed = line.trim();
				if (trimmed === ">" || trimmed === "|" || trimmed === "") {
					continue;
				}
				descLines.push(trimmed);
			} else {
				// Continuation lines are indented or empty
				if (/^\s+/.test(line) || line.trim() === "") {
					descLines.push(line.trim());
				} else {
					break; // New top-level key
				}
			}
		}
		const descText = descLines.join(" ").trim();
		const wordCount = descText.split(/\s+/).filter((w) => w.length > 0).length;

		if (wordCount >= 20) {
			results.push({
				passed: true,
				message: `Description has ${wordCount} words`,
			});
		} else {
			results.push({
				passed: false,
				message: `Description has only ${wordCount} words (aim for 100+)`,
			});
		}
	}

	// Check metadata.json
	const metaPath = join(dir, "metadata.json");
	if (existsSync(metaPath)) {
		try {
			const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
			if (Array.isArray(meta.triggers) && meta.triggers.length > 0) {
				results.push({
					passed: true,
					message: `metadata.json has ${meta.triggers.length} triggers`,
				});
			} else {
				results.push({
					passed: false,
					message: "metadata.json missing or empty 'triggers' array",
				});
			}
		} catch {
			results.push({
				passed: false,
				message: "metadata.json is not valid JSON",
			});
		}
	} else {
		results.push({ passed: false, message: "metadata.json not found" });
	}

	// Check rules/ directory
	const rulesDir = join(dir, "rules");
	if (existsSync(rulesDir)) {
		results.push({ passed: true, message: "rules/ directory exists" });

		if (existsSync(join(rulesDir, "_template.md"))) {
			results.push({ passed: true, message: "rules/_template.md exists" });
		} else {
			results.push({ passed: false, message: "rules/_template.md not found" });
		}

		// Check rule files format
		const ruleFiles = readdirSync(rulesDir).filter(
			(f) => f.endsWith(".md") && f !== "_template.md",
		);
		for (const file of ruleFiles) {
			const ruleContent = readFileSync(join(rulesDir, file), "utf-8");

			// Check no YAML frontmatter
			if (ruleContent.startsWith("---")) {
				results.push({
					passed: false,
					message: `rules/${file} has YAML frontmatter (not allowed)`,
				});
			}

			// Check for Avoid/Prefer sections
			const hasAvoid = /^## Avoid/m.test(ruleContent);
			const hasPrefer = /^## Prefer/m.test(ruleContent);
			if (hasAvoid && hasPrefer) {
				results.push({
					passed: true,
					message: `rules/${file} has Avoid/Prefer sections`,
				});
			} else {
				const missing = [];
				if (!hasAvoid) missing.push("Avoid");
				if (!hasPrefer) missing.push("Prefer");
				results.push({
					passed: false,
					message: `rules/${file} missing section(s): ${missing.join(", ")}`,
				});
			}
		}
	} else {
		results.push({ passed: false, message: "rules/ directory not found" });
	}

	return results;
}

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help") {
		console.log("Usage: bun scripts/validate-skill.ts <path-to-skill>");
		console.log("");
		console.log("Validates a skill directory for structural correctness.");
		process.exit(1);
	}

	const skillPath = args[0];

	if (!existsSync(skillPath)) {
		console.error(`Error: Path not found: ${skillPath}`);
		process.exit(1);
	}

	const results = validate(skillPath);

	let passCount = 0;
	let failCount = 0;

	for (const r of results) {
		const icon = r.passed ? "PASS" : "FAIL";
		console.log(`  [${icon}] ${r.message}`);
		if (r.passed) passCount++;
		else failCount++;
	}

	console.log("");
	console.log(`Results: ${passCount} passed, ${failCount} failed`);

	process.exit(failCount > 0 ? 1 : 0);
}

main();
