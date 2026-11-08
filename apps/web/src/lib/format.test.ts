import { describe, expect, it } from "vitest";
import { createFormatters, localeForCurrency } from "./format";

const vnd = createFormatters({
	currencyCode: "VND",
	uiLocale: "vi-VN",
	timeZone: "Asia/Ho_Chi_Minh",
	unitLabels: { million: "tr", billion: "tỷ" },
});

const nbsp = / /g;
const plain = (text: string) => text.replace(nbsp, " ");

describe("formatters for a VND tenant", () => {
	it("derives the vi-VN locale from the currency", () => {
		expect(localeForCurrency("VND", "en-GB")).toBe("vi-VN");
		expect(vnd.locale).toBe("vi-VN");
		expect(localeForCurrency("XYZ", "en-GB")).toBe("en-GB");
	});

	it("writes compact money headlines in millions and billions", () => {
		expect(plain(vnd.moneyCompact(12_400_000))).toBe("12,4 tr ₫");
		expect(plain(vnd.moneyCompact(1_234_000_000))).toBe("1,2 tỷ ₫");
		expect(plain(vnd.moneyCompact(-2_500_000))).toBe("-2,5 tr ₫");
	});

	it("moves to the next unit when rounding reaches a thousand of the smaller one", () => {
		expect(plain(vnd.moneyCompact(950_000_000))).toBe("950,0 tr ₫");
		expect(plain(vnd.moneyCompact(999_940_000))).toBe("999,9 tr ₫");
		expect(plain(vnd.moneyCompact(999_950_000))).toBe("1,0 tỷ ₫");
		expect(plain(vnd.moneyCompact(999_960_000))).toBe("1,0 tỷ ₫");
		expect(plain(vnd.moneyCompact(-999_999_999))).toBe("-1,0 tỷ ₫");
	});

	it("keeps values under a million exact and without decimals", () => {
		expect(plain(vnd.moneyCompact(950_000))).toBe("950.000 ₫");
		expect(plain(vnd.moneyExact(12_400_000))).toBe("12.400.000 ₫");
		expect(plain(vnd.moneyExact(82_947.4))).toBe("82.947 ₫");
	});

	it("formats counts as integers and percentages with one decimal", () => {
		expect(vnd.count(1234)).toBe("1.234");
		expect(vnd.count(12.6)).toBe("13");
		expect(plain(vnd.percent(0.1234))).toBe("12,3%");
		expect(plain(vnd.signedPercent(0.05))).toBe("+5,0%");
		expect(plain(vnd.signedPercent(-0.071))).toBe("-7,1%");
	});

	it("writes dates as dd/MM/yyyy", () => {
		expect(vnd.date("2026-11-08")).toBe("08/11/2026");
		expect(vnd.date("2026-01-05")).toBe("05/01/2026");
	});

	it("names weekdays in Vietnamese", () => {
		expect(vnd.weekday("2026-11-08")).toBe("Chủ Nhật");
		expect(vnd.weekday("2026-11-09")).toBe("Thứ Hai");
		expect(vnd.weekday("2026-11-14")).toBe("Thứ Bảy");
	});

	it("shows clock times in the tenant time zone", () => {
		expect(vnd.time(new Date("2026-11-08T02:44:00Z"))).toBe("09:44");
	});

	it("keeps the tenant number format when the interface is in English", () => {
		const english = createFormatters({
			currencyCode: "VND",
			uiLocale: "en-GB",
			timeZone: "Asia/Ho_Chi_Minh",
			unitLabels: { million: "M", billion: "B" },
		});
		expect(plain(english.moneyCompact(12_400_000))).toBe("12,4 M ₫");
		expect(english.weekday("2026-11-08")).toBe("Sunday");
		expect(english.date("2026-11-08")).toBe("08/11/2026");
	});
});
