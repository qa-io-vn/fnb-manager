import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const packRoot = join(import.meta.dirname, "..", "..", "src", "pack");

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
	{
		token: ".normalize(",
		pattern: /\.normalize\(/,
		allowedIn: ["request-text.ts"],
	},
	{ token: "new Date(", pattern: /\bnew\s+Date\(/, allowedIn: ["clock.ts"] },
	{
		token: "JSON.stringify",
		pattern: /\bJSON\.stringify\b/,
		allowedIn: ["canonical.ts"],
	},
];

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? sourceFiles(join(directory, entry.name))
			: entry.name.endsWith(".ts")
				? [join(directory, entry.name)]
				: [],
	);
}

function offences(file: string, text: string): string[] {
	return RULES.filter(
		(rule) => !rule.allowedIn.includes(file) && rule.pattern.test(text),
	).map((rule) => `${file}: ${rule.token}`);
}

describe("the source of src/pack", () => {
	it("uses no locale, randomness, system clock, Unicode normalisation or JSON writer outside their one place", () => {
		const files = sourceFiles(packRoot);
		expect(files.length).toBeGreaterThan(10);
		const found = files.flatMap((file) =>
			offences(
				relative(packRoot, file).split(sep).join("/"),
				readFileSync(file, "utf8"),
			),
		);
		expect(found).toEqual([]);
	});

	it("catches each refused token", () => {
		const planted: [string, string][] = [
			["x.ts", "new Intl.NumberFormat('vi')"],
			["x.ts", "value.toLocaleString()"],
			["x.ts", "a.localeCompare(b)"],
			["x.ts", "Math.random()"],
			["x.ts", "Date.now()"],
			["x.ts", "text.normalize('NFC')"],
			["x.ts", "new Date(0)"],
			["x.ts", "JSON.stringify(value)"],
			["tables/items.ts", "new  Date(1)"],
		];
		for (const [file, text] of planted) {
			expect(offences(file, text), text).toHaveLength(1);
		}
		expect(offences("request-text.ts", "text.normalize('NFC')")).toEqual([]);
		expect(offences("clock.ts", "new Date(time)")).toEqual([]);
		expect(offences("canonical.ts", "JSON.stringify(key)")).toEqual([]);
		expect(offences("tables/canonical.ts", "JSON.stringify(key)")).toHaveLength(
			1,
		);
	});
});
