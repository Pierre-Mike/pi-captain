#!/usr/bin/env bun
/**
 * Analyze a skill directory and report metrics.
 *
 * Usage:
 *   bun scripts/analyze-skill.ts <path-to-skill>
 *
 * Reports:
 *   - Total line count across all files
 *   - Rule count
 *   - Description word count
 *   - Missing standard sections
 *   - Rough token estimate (~0.75 tokens per word)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

interface AnalysisReport {
	skillName: string;
	totalLines: number;
	totalWords: number;
	estimatedTokens: number;
	skillMdLines: number;
	ruleCount: number;
	descriptionWordCount: number;
	hasReferences: boolean;
	hasScripts: boolean;
	missingSections: string[];
	files: { path: string; lines: number }[];
}

function countLines(content: string): number {
	return content.split("\n").length;
}

function countWords(content: string): number {
	return content.split(/\s+/).filter((w) => w.length > 0).length;
}

function analyze(skillPath: string): AnalysisReport {
	const dir = resolve(skillPath);
	const skillName = dir.split("/").pop() || "unknown";

	const report: AnalysisReport = {
		skillName,
		totalLines: 0,
		totalWords: 0,
		estimatedTokens: 0,
		skillMdLines: 0,
		ruleCount: 0,
		descriptionWordCount: 0,
		hasReferences: existsSync(join(dir, "references")),
		hasScripts: existsSync(join(dir, "scripts")),
		missingSections: [],
		files: [],
	};

	// Recursively collect all text files
	function walkDir(dirPath: string) {
		if (!existsSync(dirPath)) return;
		const entries = readdirSync(dirPath);
		for (const entry of entries) {
			const fullPath = join(dirPath, entry);
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				walkDir(fullPath);
			} else if (
				entry.endsWith(".md") ||
				entry.endsWith(".json") ||
				entry.endsWith(".ts") ||
				entry.endsWith(".py") ||
				entry.endsWith(".sh")
			) {
				const content = readFileSync(fullPath, "utf-8");
				const lines = countLines(content);
				const words = countWords(content);
				report.totalLines += lines;
				report.totalWords += words;
				report.files.push({
					path: fullPath.replace(dir + "/", ""),
					lines,
				});
			}
		}
	}

	walkDir(dir);

	// Analyze SKILL.md specifically
	const skillMdPath = join(dir, "SKILL.md");
	if (existsSync(skillMdPath)) {
		const content = readFileSync(skillMdPath, "utf-8");
		report.skillMdLines = countLines(content);

		// Extract description word count
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
		if (fmMatch) {
			const fmText = fmMatch[1];
			const afterDesc = fmText.substring(
				fmText.indexOf("description:") + "description:".length,
			);
			const descLines: string[] = [];
			const lines = afterDesc.split("\n");
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (i === 0) {
					const trimmed = line.trim();
					if (trimmed === ">" || trimmed === "|" || trimmed === "") continue;
					descLines.push(trimmed);
				} else if (/^\s+/.test(line) || line.trim() === "") {
					descLines.push(line.trim());
				} else {
					break;
				}
			}
			report.descriptionWordCount = countWords(descLines.join(" "));
		}

		// Check for standard sections
		const expectedSections = [
			"Core Concepts",
			"Quick Patterns",
			"Reference Files",
		];
		for (const section of expectedSections) {
			if (!content.includes(`## ${section}`)) {
				report.missingSections.push(section);
			}
		}
	}

	// Count rule files
	const rulesDir = join(dir, "rules");
	if (existsSync(rulesDir)) {
		report.ruleCount = readdirSync(rulesDir).filter(
			(f) => f.endsWith(".md") && f !== "_template.md",
		).length;
	}

	// Estimate tokens (~0.75 tokens per word for English markdown)
	report.estimatedTokens = Math.round(report.totalWords * 0.75);

	return report;
}

function main() {
	const args = process.argv.slice(2);

	if (args.length === 0 || args[0] === "--help") {
		console.log("Usage: bun scripts/analyze-skill.ts <path-to-skill>");
		console.log("");
		console.log("Analyzes a skill directory and reports metrics.");
		process.exit(1);
	}

	const skillPath = args[0];

	if (!existsSync(skillPath)) {
		console.error(`Error: Path not found: ${skillPath}`);
		process.exit(1);
	}

	const report = analyze(skillPath);

	console.log(`Skill: ${report.skillName}`);
	console.log("---");
	console.log(`SKILL.md lines:      ${report.skillMdLines}`);
	console.log(`Total lines:         ${report.totalLines}`);
	console.log(`Total words:         ${report.totalWords}`);
	console.log(`Estimated tokens:    ~${report.estimatedTokens}`);
	console.log(`Rule count:          ${report.ruleCount}`);
	console.log(`Description words:   ${report.descriptionWordCount}`);
	console.log(`Has references/:     ${report.hasReferences ? "yes" : "no"}`);
	console.log(`Has scripts/:        ${report.hasScripts ? "yes" : "no"}`);

	if (report.missingSections.length > 0) {
		console.log(`Missing sections:    ${report.missingSections.join(", ")}`);
	}

	console.log("");
	console.log("Files:");
	for (const f of report.files.sort((a, b) => b.lines - a.lines)) {
		console.log(`  ${String(f.lines).padStart(4)} lines  ${f.path}`);
	}
}

main();
