import { describe, expect, it } from "vitest";
import { asOfDate, periodBounds } from "../../src/index.js";

const SAIGON = "Asia/Ho_Chi_Minh";

describe("asOfDate", () => {
	it("is the store's business date minus one", () => {
		const stores = [{ timeZone: SAIGON, businessDayStartMinutes: 0 }];
		expect(asOfDate(stores, new Date("2026-11-04T05:30:00Z"))).toBe(
			"2026-11-03",
		);
	});

	it("keeps the previous business day before a 05:00 start", () => {
		const stores = [{ timeZone: SAIGON, businessDayStartMinutes: 300 }];
		expect(asOfDate(stores, new Date("2026-11-04T21:30:00Z"))).toBe(
			"2026-11-03",
		);
		expect(asOfDate(stores, new Date("2026-11-04T22:30:00Z"))).toBe(
			"2026-11-04",
		);
	});

	it("rolls at local midnight, not UTC midnight", () => {
		const stores = [{ timeZone: SAIGON, businessDayStartMinutes: 0 }];
		expect(asOfDate(stores, new Date("2026-11-04T16:59:00Z"))).toBe(
			"2026-11-03",
		);
		expect(asOfDate(stores, new Date("2026-11-04T17:00:00Z"))).toBe(
			"2026-11-04",
		);
	});

	it("takes the earliest as-of day over the stores", () => {
		const stores = [
			{ timeZone: SAIGON, businessDayStartMinutes: 0 },
			{ timeZone: SAIGON, businessDayStartMinutes: 300 },
		];
		expect(asOfDate(stores, new Date("2026-11-04T18:00:00Z"))).toBe(
			"2026-11-03",
		);
	});

	it("uses the UTC date without stores", () => {
		expect(asOfDate([], new Date("2026-11-04T23:30:00Z"))).toBe("2026-11-03");
	});
});

describe("periodBounds", () => {
	it("compares a day with the day before, 364 days before and the baseline weeks", () => {
		expect(periodBounds("day", "2026-11-03")).toEqual([
			{ period: "current", from: "2026-11-03", to: "2026-11-03" },
			{ period: "previous", from: "2026-11-02", to: "2026-11-02" },
			{ period: "last_year", from: "2025-11-04", to: "2025-11-04" },
			{ period: "baseline", from: "2026-09-08", to: "2026-10-27" },
		]);
	});

	it("keeps the same elapsed days of a week", () => {
		expect(periodBounds("week", "2026-11-04")).toEqual([
			{ period: "current", from: "2026-11-02", to: "2026-11-04" },
			{ period: "previous", from: "2026-10-26", to: "2026-10-28" },
			{ period: "last_year", from: "2025-11-03", to: "2025-11-05" },
		]);
	});

	it("clips the previous month at its end", () => {
		expect(periodBounds("month", "2026-03-31")).toEqual([
			{ period: "current", from: "2026-03-01", to: "2026-03-31" },
			{ period: "previous", from: "2026-02-01", to: "2026-02-28" },
			{ period: "last_year", from: "2025-03-01", to: "2025-03-31" },
		]);
		expect(periodBounds("month", "2028-02-29")[2]).toEqual({
			period: "last_year",
			from: "2027-02-01",
			to: "2027-02-28",
		});
	});

	it("uses the same elapsed days of the previous year for both year references", () => {
		expect(periodBounds("year", "2029-03-01")).toEqual([
			{ period: "current", from: "2029-01-01", to: "2029-03-01" },
			{ period: "previous", from: "2028-01-01", to: "2028-02-29" },
			{ period: "last_year", from: "2028-01-01", to: "2028-02-29" },
		]);
		expect(periodBounds("year", "2028-12-31")[1]?.to).toBe("2027-12-31");
	});
});
