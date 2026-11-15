import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const messagesDirectory = join(import.meta.dirname, "messages");
const reportsDirectory = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"docs",
	"reports",
);

const SHEETS = {
	"cau-van-bao-cao.md": [
		"reports",
		"report-day",
		"report-week",
		"report-month",
		"report-year",
	],
	"cau-van-chu-de.md": [
		"themes",
		"theme-revenue",
		"theme-hours",
		"theme-menu",
		"theme-payments",
		"settings",
		"settings-thresholds",
		"settings-mapping",
	],
} as const;

const ROW = /^\| `([^`]+)` \| (.*) \| (.*) \| (.*) \|$/;
const TOTALS = /\((\d+) entries, (\d+) of them with placeholders\)/;
const PLACEHOLDER = /\{([^}]+)\}/g;

interface SheetRow {
	readonly vi: string;
	readonly en: string;
	readonly placeholders: string;
}

function messagesOf(name: string, language: "vi" | "en") {
	return JSON.parse(
		readFileSync(join(messagesDirectory, `${name}.${language}.json`), "utf8"),
	) as Record<string, string>;
}

function unescaped(cell: string): string {
	return cell.replaceAll("\\|", "|");
}

function sheetText(sheet: string): string {
	return readFileSync(join(reportsDirectory, sheet), "utf8");
}

function rowsOf(sheet: string): Map<string, SheetRow> {
	const rows = new Map<string, SheetRow>();
	const text = sheetText(sheet);
	for (const line of text.split("\n")) {
		const match = ROW.exec(line);
		if (match === null) continue;
		const [, key, vi, en, placeholders] = match;
		if (key === undefined || key.startsWith("{")) continue;
		expect(rows.has(key), `${sheet} lists ${key} twice`).toBe(false);
		rows.set(key, {
			vi: unescaped(vi ?? ""),
			en: unescaped(en ?? ""),
			placeholders: placeholders ?? "",
		});
	}
	return rows;
}

function placeholdersOf(template: string): string {
	const names = [
		...new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1])),
	];
	return names.length === 0
		? "—"
		: names.map((name) => `\`{${name}}\``).join(" ");
}

describe("the owner's wording sheets", () => {
	for (const [sheet, files] of Object.entries(SHEETS)) {
		it(`${sheet} lists every key of its message files with the exact Vietnamese, English and placeholders, and nothing else`, () => {
			const rows = rowsOf(sheet);
			const expected = new Map<string, SheetRow>();
			for (const name of files) {
				const vi = messagesOf(name, "vi");
				const en = messagesOf(name, "en");
				for (const [key, text] of Object.entries(vi)) {
					expected.set(key, {
						vi: text,
						en: en[key] ?? "",
						placeholders: placeholdersOf(text),
					});
				}
			}
			expect([...rows.keys()].sort()).toEqual([...expected.keys()].sort());
			for (const [key, row] of expected) {
				expect(rows.get(key), key).toEqual(row);
			}
		});

		it(`${sheet} states the right totals and the right count under each file's heading`, () => {
			const text = sheetText(sheet);
			let total = 0;
			let withPlaceholders = 0;
			for (const name of files) {
				const templates = Object.values(messagesOf(name, "vi"));
				total += templates.length;
				withPlaceholders += templates.filter((template) =>
					template.includes("{"),
				).length;
				expect(text, name).toContain(
					`(\`${name}.vi.json\`, ${templates.length} mục)`,
				);
			}
			const totals = TOTALS.exec(text);
			expect(totals?.[1]).toBe(String(total));
			expect(totals?.[2]).toBe(String(withPlaceholders));
		});
	}
});
