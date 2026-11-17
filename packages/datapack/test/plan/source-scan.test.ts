import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const planRoot = join(import.meta.dirname, "..", "..", "src", "plan");

interface Rule {
	readonly token: string;
	readonly pattern: RegExp;
	readonly allowedIn: readonly string[];
}

const RULES: readonly Rule[] = [
	{ token: "Intl.", pattern: /\bIntl\./, allowedIn: [] },
	{ token: "toLocale", pattern: /\btoLocale/, allowedIn: [] },
	{ token: "localeCompare", pattern: /\blocaleCompare\b/, allowedIn: [] },
	{ token: "Math.random", pattern: /\bMath\.random\b/, allowedIn: [] },
	{ token: "Date.now", pattern: /\bDate\.now\b/, allowedIn: [] },
	{ token: "new Date(", pattern: /\bnew\s+Date\(/, allowedIn: [] },
	{
		token: ".normalize(",
		pattern: /\.normalize\(/,
		allowedIn: ["normalize.ts"],
	},
	{ token: "JSON.stringify", pattern: /\bJSON\.stringify\b/, allowedIn: [] },
	{
		token: "window.",
		pattern: /\b(?:window|document|navigator)\./,
		allowedIn: [],
	},
];

function offences(file: string, text: string): string[] {
	return RULES.filter(
		(rule) => !rule.allowedIn.includes(file) && rule.pattern.test(text),
	).map((rule) => `${file}: ${rule.token}`);
}

describe("the source of src/plan", () => {
	it("uses no locale, clock, randomness, browser global or Unicode normalisation outside normalize.ts", () => {
		const files = readdirSync(planRoot).filter((name) => name.endsWith(".ts"));
		expect(files.length).toBeGreaterThan(8);
		const found = files.flatMap((file) =>
			offences(file, readFileSync(join(planRoot, file), "utf8")),
		);
		expect(found).toEqual([]);
	});

	it("catches each refused token", () => {
		for (const text of [
			"new Intl.NumberFormat('vi')",
			"value.toLocaleString()",
			"a.localeCompare(b)",
			"Math.random()",
			"Date.now()",
			"new Date(0)",
			"text.normalize('NFC')",
			"JSON.stringify(value)",
			"window.location",
			"navigator.language",
		]) {
			expect(offences("lint.ts", text), text).toHaveLength(1);
		}
		expect(offences("normalize.ts", "text.normalize('NFC')")).toEqual([]);
	});
});
