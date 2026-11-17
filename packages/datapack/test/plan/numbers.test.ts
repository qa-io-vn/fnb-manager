import { describe, expect, it } from "vitest";
import type { PackLanguage, PackUnit } from "../../src/index.js";
import {
	jsonNumberReading,
	maskedSpans,
	readingMatches,
	readNumberText,
	tokenizeLine,
	writtenMatchesCell,
} from "../../src/plan/numbers.js";

type Case = readonly [
	text: string,
	cell: number,
	unit: PackUnit,
	matches: boolean,
];

function matches(
	text: string,
	language: PackLanguage,
	cell: number,
	unit: PackUnit,
): boolean {
	const readings = readNumberText(text, language);
	if (readings === null) throw new Error(`not one number: ${text}`);
	return writtenMatchesCell(readings, cell, unit);
}

const VIETNAMESE: readonly Case[] = [
	["1.234.567 đ", 1234567, "money", true],
	["1.234.567 đ", 1234667, "money", false],
	["1 234 567 đồng", 1234567, "money", true],
	["1\u00A0234\u00A0567", 1234567, "money", true],
	["52.314 đ", 52314.27, "money", true],
	["52.314đ", 52314.27, "money", true],
	["52.314,27 ₫", 52314.27, "money", true],
	["52.300 đ", 52314.27, "money", true],
	["52.400 đ", 52314.27, "money", false],
	["12,5 triệu đồng", 12456789, "money", true],
	["12,5 triệu", 12600000, "money", false],
	["12,5tr", 12500000, "money", true],
	["52,3 nghìn đ", 52314.27, "money", true],
	["52k", 52314.27, "money", true],
	["1,2 tỷ", 1234567890, "money", true],
	["1,23 tỷ đồng", 1234567890, "money", true],
	["1,2 tỷ", 1290000000, "money", false],
	["12,5 tỷ", 12500000, "money", false],
	["12,5 tỉ", 12500000000, "money", true],
	["1,29 tỷ đồng", 1287540.5, "money_thousands", true],
	["1.287.540,5 nghìn đồng", 1287540.5, "money_thousands", true],
	["1.287.541", 1287540.5, "money_thousands", true],
	["1,29 tỷ đồng", 1287540.5, "money", false],
	["35,2%", 0.352, "fraction", true],
	["35,2 %", 0.352, "fraction", true],
	["35,2 phần trăm", 0.352, "fraction", true],
	["35,2%", 0.362, "fraction", false],
	["35%", 0.352, "fraction", true],
	["36%", 0.352, "fraction", false],
	["0,35", 0.352, "fraction", true],
	["3,2 điểm", -0.032, "pp_change", true],
	["3,2 điểm %", -0.032, "pp_change", true],
	["3,2 điểm phần trăm", -0.032, "pp_change", true],
	["3,4 điểm", -0.032, "pp_change", false],
	["12,4%", -0.124, "rel_change", true],
	["1.234", 1234, "count", true],
	["1.234", 1.234, "ratio", true],
	["1,234", 1234, "count", true],
	["1,234", 1.234, "ratio", true],
	["1.234", 12.34, "ratio", false],
	["123,456", 123456, "count", true],
	["123,456", 123.456, "quantity", true],
	["1234,567", 1234567, "count", false],
	["1234,567", 1234.567, "quantity", true],
	["3.120", 3120, "quantity", true],
	["0", 0.3, "count", true],
	["0%", 0, "fraction", true],
];

const ENGLISH: readonly Case[] = [
	["1,234,567 VND", 1234567, "money", true],
	["1,234,567 VND", 1234667, "money", false],
	["52,314 VND", 52314.27, "money", true],
	["52,314.27", 52314.27, "money", true],
	["12.5 million", 12456789, "money", true],
	["12.5 million VND", 12600000, "money", false],
	["12.5m", 12500000, "money", true],
	["52.3 thousand", 52314.27, "money", true],
	["1.23 billion VND", 1234567890, "money", true],
	["1.2bn", 1234567890, "money", true],
	["12.5 billion", 12500000, "money", false],
	["1.29 billion VND", 1287540.5, "money_thousands", true],
	["1.29 billion VND", 1287540.5, "money", false],
	["35.2%", 0.352, "fraction", true],
	["35.2 percent", 0.352, "fraction", true],
	["35.2 per cent", 0.352, "fraction", true],
	["35.2%", 0.362, "fraction", false],
	["3.2 percentage points", -0.032, "pp_change", true],
	["3.2 pp", -0.032, "pp_change", true],
	["3.2 points", -0.032, "pp_change", true],
	["3.4 pp", -0.032, "pp_change", false],
	["1,234", 1234, "count", true],
	["1,234", 1.234, "ratio", true],
	["1.234", 1234, "count", true],
	["1.234", 1.234, "ratio", true],
	["1.234", 12.34, "ratio", false],
	["12,500", 12.5, "ratio", true],
	["3,120", 3120, "quantity", true],
];

describe("the number grammar", () => {
	it.each(VIETNAMESE)(
		"vi: %s against %s (%s) matches: %s",
		(text, cell, unit, expected) => {
			expect(matches(text, "vi", cell, unit)).toBe(expected);
		},
	);

	it.each(ENGLISH)(
		"en: %s against %s (%s) matches: %s",
		(text, cell, unit, expected) => {
			expect(matches(text, "en", cell, unit)).toBe(expected);
		},
	);

	it("refuses a decimal mark of the other language that is not a single group of three", () => {
		expect(readNumberText("12.5", "vi")).toEqual([]);
		expect(readNumberText("12.5%", "vi")).toEqual([]);
		expect(readNumberText("1.234.5", "vi")).toEqual([]);
		expect(readNumberText("1234.567", "vi")).toEqual([]);
		expect(readNumberText("12,5", "en")).toEqual([]);
		expect(readNumberText("1.234.567", "en")).toEqual([]);
		expect(readNumberText("1,234,56", "en")).toEqual([]);
	});

	it("reads a single ambiguous group both ways and nothing else", () => {
		expect(readNumberText("1.234", "vi")).toEqual([
			{ value: 1234, unit: 1 },
			{ value: 1.234, unit: 0.001 },
		]);
		expect(readNumberText("1,234", "en")).toEqual([
			{ value: 1234, unit: 1 },
			{ value: 1.234, unit: 0.001 },
		]);
		expect(readNumberText("1 234", "vi")).toEqual([{ value: 1234, unit: 1 }]);
		expect(readNumberText("1.234.567", "vi")).toHaveLength(1);
		expect(readNumberText("1.234,5", "vi")).toEqual([
			{ value: 1234.5, unit: 0.1 },
		]);
	});

	it("takes the unit from the last significant written digit", () => {
		expect(readNumberText("52.300", "vi")).toEqual([
			{ value: 52300, unit: 100 },
			{ value: 52.3, unit: 0.001 },
		]);
		expect(readNumberText("12,50", "vi")).toEqual([
			{ value: 12.5, unit: 0.01 },
		]);
		expect(readNumberText("12,5 triệu", "vi")).toEqual([
			{ value: 12500000, unit: 100000 },
		]);
		expect(readNumberText("4,25%", "vi")?.[0]?.unit).toBeCloseTo(0.0001, 12);
		expect(readNumberText("0", "vi")).toEqual([{ value: 0, unit: 1 }]);
	});

	it("reads signs as words and compares absolute values", () => {
		const [token] = tokenizeLine("giảm -3,2%", [], "vi").filter(
			(entry) => entry.kind === "number",
		);
		expect(token?.text).toBe("3,2%");
		expect(
			writtenMatchesCell(token?.readings ?? [], -0.032, "rel_change"),
		).toBe(true);
		expect(writtenMatchesCell(token?.readings ?? [], 0.032, "rel_change")).toBe(
			true,
		);
	});

	it("never matches a cell that is not a finite number", () => {
		const readings = readNumberText("12", "vi") ?? [];
		expect(writtenMatchesCell(readings, null, "count")).toBe(false);
		expect(writtenMatchesCell(readings, "12", "text")).toBe(false);
		expect(writtenMatchesCell(readings, true, "flag")).toBe(false);
		expect(writtenMatchesCell(readings, Number.NaN, "count")).toBe(false);
	});

	it("allows a tiny relative tolerance for floating point", () => {
		expect(readingMatches({ value: 0.3, unit: 0 }, 0.1 + 0.2)).toBe(true);
		expect(readingMatches({ value: 1e15, unit: 0 }, 1e15 + 0.5)).toBe(true);
		expect(readingMatches({ value: 1, unit: 0 }, 1.0001)).toBe(false);
	});

	it("reads front-matter numbers with the same rule", () => {
		expect(jsonNumberReading(52314.27)).toEqual({
			value: 52314.27,
			unit: 0.01,
		});
		expect(jsonNumberReading(52300)).toEqual({ value: 52300, unit: 100 });
		expect(jsonNumberReading(-0.0425)).toEqual({ value: 0.0425, unit: 0.0001 });
		expect(jsonNumberReading(1.5e21)).toEqual({ value: 1.5e21, unit: 1e20 });
		expect(jsonNumberReading(1e-7).value).toBeCloseTo(1e-7, 20);
	});
});

describe("tokens of a line", () => {
	function kinds(text: string, language: PackLanguage = "vi") {
		return tokenizeLine(text, [], language).map((token) => [
			token.kind,
			token.text,
		]);
	}

	it("keeps digits inside words, such as store labels and window names", () => {
		expect(kinds("S1 và w28, ly28 avg_ticket peak_share_20_21")).toEqual([
			["word", "S1"],
			["word", "và"],
			["word", "w28"],
			["word", "ly28"],
			["word", "avg_ticket"],
			["word", "peak_share_20_21"],
		]);
		expect(kinds("3x 28ngày 52kg")).toEqual([
			["word", "3x"],
			["word", "28ngày"],
			["word", "52kg"],
		]);
	});

	it("attaches the scale, currency and percent words to the number", () => {
		expect(kinds("đạt 1,2 tỷ đồng, tăng 3,2 điểm % và 12% khách")).toEqual([
			["word", "đạt"],
			["number", "1,2 tỷ đồng"],
			["word", "tăng"],
			["number", "3,2 điểm %"],
			["word", "và"],
			["number", "12%"],
			["word", "khách"],
		]);
		expect(kinds("5 trong 7 món, 3 mới", "vi")).toEqual([
			["number", "5"],
			["word", "trong"],
			["number", "7"],
			["word", "món"],
			["number", "3"],
			["word", "mới"],
		]);
	});

	it("masks dates, times, hour ranges, 30/60/90 and list numbering", () => {
		const masked = (text: string) =>
			maskedSpans(text).map((span) => text.slice(span.start, span.end));
		expect(masked("ngày 2026-11-11, tuần 2026-W45, tháng 2026-10")).toEqual([
			"2026-11-11",
			"2026-W45",
			"2026-10",
		]);
		expect(masked("15/12, 15/12/2026, 15.12.2026, 11/2026")).toEqual([
			"15/12",
			"15/12/2026",
			"15.12.2026",
			"11/2026",
		]);
		expect(masked("20:00, 20h, 20h30, 5pm, 5:30 am")).toEqual([
			"20:00",
			"20h",
			"20h30",
			"5pm",
			"5:30 am",
		]);
		expect(masked("17–19h, 17h-19h, 17-19 giờ, 17:00—19:00, 5-7 món")).toEqual([
			"17–19h",
			"17h-19h",
			"17-19 giờ",
			"17:00—19:00",
		]);
		expect(masked("Kế hoạch 30/60/90 ngày")).toEqual(["30/60/90"]);
		expect(masked("năm 2026 và 2.026 khách")).toEqual(["2026"]);
		expect(
			masked("tháng 10, Tuần 45, thứ 7, sáng kiến 2, initiative 3"),
		).toEqual(["10", "45", "7", "2", "3"]);
		expect(masked("1. Doanh thu")).toEqual(["1."]);
		expect(masked("  - 2) Doanh thu")).toEqual(["2)"]);
		expect(masked("1.234.567 đ, 52.314 đ, 12,5%")).toEqual([]);
	});
});
