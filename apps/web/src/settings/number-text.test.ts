import { REPORT_SETTING_LIMITS } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	formatNumberText,
	fractionToPercent,
	parseNumberText,
	percentLimitOf,
	percentToFraction,
	readNumberDraft,
	reformatNumberText,
	separatorsOf,
} from "./number-text";
import { integerInRange } from "./validation";

describe("separatorsOf", () => {
	it("reads the group and decimal marks of a locale", () => {
		expect(separatorsOf("vi-VN")).toEqual({ group: ".", decimal: "," });
		expect(separatorsOf("en-GB")).toEqual({ group: ",", decimal: "." });
	});
});

describe("parseNumberText", () => {
	it("reads Vietnamese grouping and decimal comma", () => {
		expect(parseNumberText("50.000", "vi-VN")).toBe(50_000);
		expect(parseNumberText("1.234.567", "vi-VN")).toBe(1_234_567);
		expect(parseNumberText("0,5", "vi-VN")).toBe(0.5);
		expect(parseNumberText("1.234,25", "vi-VN")).toBe(1234.25);
		expect(parseNumberText(" 50 000 ", "vi-VN")).toBe(50_000);
	});

	it("takes grouping only in groups of three after a first group that is not zero", () => {
		expect(parseNumberText("1.500", "vi-VN")).toBe(1500);
		expect(parseNumberText("50 000", "vi-VN")).toBe(50_000);
		for (const text of [
			"0.750",
			"0.5",
			"12.75",
			"10.0000",
			"1.50.000",
			"50.000 000",
		]) {
			expect(parseNumberText(text, "vi-VN"), text).toBeNull();
		}
	});

	it("reads either mark as the decimal mark where grouping makes no sense", () => {
		const loose = { grouping: false } as const;
		expect(parseNumberText("0.750", "vi-VN", loose)).toBe(0.75);
		expect(parseNumberText("1.125", "vi-VN", loose)).toBe(1.125);
		expect(parseNumberText("1,125", "vi-VN", loose)).toBe(1.125);
		expect(parseNumberText("1,125", "en-GB", loose)).toBe(1.125);
		expect(parseNumberText("1.000,5", "vi-VN", loose)).toBeNull();
	});

	it("reads English grouping and decimal point", () => {
		expect(parseNumberText("50,000", "en-GB")).toBe(50_000);
		expect(parseNumberText("0.5", "en-GB")).toBe(0.5);
		expect(parseNumberText("1,234.5", "en-GB")).toBe(1234.5);
	});

	it("drops the affixes a field allows", () => {
		expect(parseNumberText("50.000 ₫", "vi-VN", { affixes: ["₫"] })).toBe(
			50_000,
		);
		expect(parseNumberText("₫ 50.000", "vi-VN", { affixes: ["₫"] })).toBe(
			50_000,
		);
		expect(parseNumberText("0,5%", "vi-VN", { affixes: ["%"] })).toBe(0.5);
	});

	it("drops affixes and spaces only around the number, never inside it", () => {
		expect(parseNumberText("12 5", "vi-VN")).toBeNull();
		expect(parseNumberText("5%0", "vi-VN", { affixes: ["%"] })).toBeNull();
		expect(parseNumberText("50₫000", "vi-VN", { affixes: ["₫"] })).toBeNull();
	});

	it("reads either mark as thousands grouping where only whole numbers make sense", () => {
		const whole = { whole: true } as const;
		expect(parseNumberText("80,000", "vi-VN", whole)).toBe(80_000);
		expect(parseNumberText("80.000", "vi-VN", whole)).toBe(80_000);
		expect(parseNumberText("1,250,000", "vi-VN", whole)).toBe(1_250_000);
		expect(parseNumberText("80 000", "vi-VN", whole)).toBe(80_000);
		expect(parseNumberText("80000", "vi-VN", whole)).toBe(80_000);
		expect(parseNumberText("80,000", "vi-VN")).toBe(80);
	});

	it("still reads a real fraction in a whole-number field, so it can be refused by name", () => {
		const whole = { whole: true } as const;
		expect(parseNumberText("80,5", "vi-VN", whole)).toBe(80.5);
		expect(parseNumberText("50.000,5", "vi-VN", whole)).toBe(50_000.5);
		expect(parseNumberText("0,500", "vi-VN", whole)).toBe(0.5);
		expect(parseNumberText("1.250,000", "vi-VN", whole)).toBe(1250);
		expect(parseNumberText("1,250.000", "vi-VN", whole)).toBeNull();
		expect(parseNumberText("12,50,000", "vi-VN", whole)).toBeNull();
	});

	it("refuses text that is not one number", () => {
		for (const text of ["", "abc", "1.2.3,4,5", "12,5,5", "5k", "1..0", "-"]) {
			expect(parseNumberText(text, "vi-VN"), text).toBeNull();
		}
	});
});

describe("formatNumberText and reformatNumberText", () => {
	it("writes the locale's grouping and keeps the allowed decimals", () => {
		expect(formatNumberText(50_000, "vi-VN", 0)).toBe("50.000");
		expect(formatNumberText(0.5, "vi-VN", 3)).toBe("0,5");
		expect(reformatNumberText("50000", "vi-VN", 0)).toBe("50.000");
		expect(reformatNumberText("1,125", "vi-VN", 3)).toBe("1,125");
	});

	it("never rounds a value it cannot show exactly", () => {
		expect(reformatNumberText("50.000,5", "vi-VN", 0)).toBeNull();
		expect(reformatNumberText("1,1255", "vi-VN", 3)).toBeNull();
		expect(reformatNumberText("abc", "vi-VN", 0)).toBeNull();
	});
});

describe("readNumberDraft", () => {
	const schema = integerInRange(1, 6);

	it("reports an empty required field, a non-number and a value out of range", () => {
		expect(readNumberDraft("", "vi-VN", schema)).toEqual({
			value: null,
			issue: { key: "required" },
		});
		expect(readNumberDraft("", "vi-VN", schema, { required: false })).toEqual({
			value: null,
			issue: null,
		});
		expect(readNumberDraft("ba", "vi-VN", schema)).toEqual({
			value: null,
			issue: { key: "number" },
		});
		expect(readNumberDraft("7", "vi-VN", schema)).toEqual({
			value: 7,
			issue: { key: "range", min: 1, max: 6 },
		});
		expect(readNumberDraft("3", "vi-VN", schema)).toEqual({
			value: 3,
			issue: null,
		});
	});
});

describe("percent and fraction", () => {
	it("shows a fraction column as a percentage with two fewer decimals", () => {
		expect(percentLimitOf(REPORT_SETTING_LIMITS.cashRelThreshold)).toEqual({
			min: 0,
			max: 10,
			fractionDigits: 2,
		});
		expect(percentLimitOf(REPORT_SETTING_LIMITS.busyHourRatio)).toEqual({
			min: 105,
			max: 300,
			fractionDigits: 1,
		});
		expect(fractionToPercent(0.005, 4)).toBe(0.5);
		expect(fractionToPercent(0.7, 3)).toBe(70);
		expect(percentToFraction(0.5, 4)).toBe(0.005);
		expect(percentToFraction(12.34, 4)).toBe(0.1234);
	});
});
