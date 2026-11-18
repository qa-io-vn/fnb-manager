import { describe, expect, it } from "vitest";
import { createHomeFormatters } from "./format";

const NBSP = " ";

function formatters(language: "vi" | "en") {
	return createHomeFormatters({
		currencyCode: "VND",
		language,
		timeZone: "Asia/Ho_Chi_Minh",
		million: language === "vi" ? "tr" : "M",
		billion: language === "vi" ? "tỷ" : "B",
	});
}

describe("the home's formatting, as the web app formats", () => {
	it("shows amounts in tr ₫ or tỷ ₫ with one decimal and the exact value in đồng", () => {
		const vi = formatters("vi");
		expect(vi.moneyCompact(12_450_000)).toBe("12,5 tr ₫");
		expect(vi.moneyExact(12_450_000)).toBe(`12.450.000${NBSP}₫`);
		expect(vi.moneyCompact(1_000_000)).toBe("1,0 tr ₫");
		expect(vi.moneyCompact(850_000)).toBe(`850.000${NBSP}₫`);
		expect(vi.moneyCompact(999_960_000)).toBe("1,0 tỷ ₫");
		expect(vi.moneyCompact(1_234_000_000)).toBe("1,2 tỷ ₫");
		expect(vi.moneyCompact(-2_500_000)).toBe("-2,5 tr ₫");
	});

	it("keeps the currency's locale and only changes the unit labels in English", () => {
		const en = formatters("en");
		expect(en.moneyCompact(12_450_000)).toBe("12,5 M ₫");
		expect(en.moneyExact(12_450_000)).toBe(`12.450.000${NBSP}₫`);
		expect(en.count(1234)).toBe("1.234");
	});

	it("writes dates as dd/MM/yyyy and times as HH:mm in the tenant's time zone", () => {
		const vi = formatters("vi");
		expect(vi.date("2026-11-08")).toBe("08/11/2026");
		expect(vi.time(new Date("2026-11-18T04:05:00Z"))).toBe("11:05");
		expect(formatters("en").time(new Date("2026-11-18T16:30:00Z"))).toBe(
			"23:30",
		);
	});
});
