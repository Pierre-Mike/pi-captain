import { describe, expect, test } from "bun:test";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
	test("parses basic key:value pairs", () => {
		const result = parseFrontmatter(
			"name: my-agent\ndescription: A test agent",
		);
		expect(result.name).toBe("my-agent");
		expect(result.description).toBe("A test agent");
	});

	test("parses YAML list syntax", () => {
		const result = parseFrontmatter("tools:\n  - read\n  - bash\n  - edit");
		expect(result.tools).toEqual(["read", "bash", "edit"]);
	});

	test("parses comma-separated values as array", () => {
		const result = parseFrontmatter("tools: read,bash,edit");
		expect(result.tools).toEqual(["read", "bash", "edit"]);
	});

	test("coerces boolean true", () => {
		const result = parseFrontmatter("enabled: true");
		expect(result.enabled).toBe(true);
	});

	test("coerces boolean false", () => {
		const result = parseFrontmatter("enabled: false");
		expect(result.enabled).toBe(false);
	});

	test("coerces numbers", () => {
		const result = parseFrontmatter("temperature: 0.7");
		expect(result.temperature).toBe(0.7);
	});

	test("coerces integers", () => {
		const result = parseFrontmatter("count: 3");
		expect(result.count).toBe(3);
	});

	test("strips quotes from string values", () => {
		const result = parseFrontmatter('model: "sonnet"');
		expect(result.model).toBe("sonnet");
	});

	test("strips single quotes from string values", () => {
		const result = parseFrontmatter("model: 'flash'");
		expect(result.model).toBe("flash");
	});

	test("handles empty frontmatter", () => {
		const result = parseFrontmatter("");
		expect(Object.keys(result)).toHaveLength(0);
	});

	test("handles missing value (key only, followed by list)", () => {
		const result = parseFrontmatter("skills:\n  - skill1\n  - skill2");
		expect(result.skills).toEqual(["skill1", "skill2"]);
	});

	test("parses full agent frontmatter", () => {
		const fm = [
			"name: architect",
			"description: Plans and designs software architecture",
			"tools:",
			"  - read",
			"  - bash",
			"model: sonnet",
			"temperature: 0.3",
		].join("\n");
		const result = parseFrontmatter(fm);
		expect(result.name).toBe("architect");
		expect(result.description).toBe("Plans and designs software architecture");
		expect(result.tools).toEqual(["read", "bash"]);
		expect(result.model).toBe("sonnet");
		expect(result.temperature).toBe(0.3);
	});
});
