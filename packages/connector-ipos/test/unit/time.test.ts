import { describe, expect, it } from "vitest";
import {
	MILLISECONDS_PER_DAY,
	VIETNAM_UTC_OFFSET_MS,
	vietnamDateISO,
	vietnamDayRange,
	vietnamDaysAgo,
	vietnamRange,
} from "../../src/index.js";

describe("vietnamDayRange", () => {
	it("covers local midnight to 23:59:59.999 at +07:00", () => {
		const { startDate, endDate } = vietnamDayRange("2026-06-15");

		expect(startDate).toBe(Date.UTC(2026, 5, 14, 17, 0, 0, 0));
		expect(endDate).toBe(Date.UTC(2026, 5, 15, 16, 59, 59, 999));
		expect(endDate - startDate).toBe(MILLISECONDS_PER_DAY - 1);
	});

	it("handles the first day of a month after a 28-day February", () => {
		const { startDate, endDate } = vietnamDayRange("2026-03-01");

		expect(startDate).toBe(Date.UTC(2026, 1, 28, 17, 0, 0, 0));
		expect(endDate).toBe(Date.UTC(2026, 2, 1, 16, 59, 59, 999));
	});

	it("handles the last day of the year", () => {
		const { startDate, endDate } = vietnamDayRange("2025-12-31");

		expect(startDate).toBe(Date.UTC(2025, 11, 30, 17, 0, 0, 0));
		expect(endDate).toBe(Date.UTC(2025, 11, 31, 16, 59, 59, 999));
	});

	it("returns integers", () => {
		const { startDate, endDate } = vietnamDayRange("2026-11-07");

		expect(Number.isInteger(startDate)).toBe(true);
		expect(Number.isInteger(endDate)).toBe(true);
	});

	it("rejects malformed and impossible dates", () => {
		expect(() => vietnamDayRange("2026-13-01")).toThrow(RangeError);
		expect(() => vietnamDayRange("2026-02-30")).toThrow(RangeError);
		expect(() => vietnamDayRange("07/11/2026")).toThrow(RangeError);
		expect(() => vietnamDayRange("2026-11-07T00:00:00Z")).toThrow(RangeError);
	});
});

describe("vietnamRange", () => {
	it("spans inclusive days across a month boundary", () => {
		const { startDate, endDate } = vietnamRange("2026-01-31", "2026-02-01");

		expect(startDate).toBe(Date.UTC(2026, 0, 30, 17, 0, 0, 0));
		expect(endDate).toBe(Date.UTC(2026, 1, 1, 16, 59, 59, 999));
		expect(endDate - startDate + 1).toBe(2 * MILLISECONDS_PER_DAY);
	});

	it("accepts a single-day range equal to vietnamDayRange", () => {
		expect(vietnamRange("2026-05-05", "2026-05-05")).toEqual(
			vietnamDayRange("2026-05-05"),
		);
	});

	it("rejects a reversed range", () => {
		expect(() => vietnamRange("2026-02-02", "2026-02-01")).toThrow(RangeError);
	});
});

describe("vietnamDateISO", () => {
	it("round-trips a day start and the instant before the next day", () => {
		const { startDate, endDate } = vietnamDayRange("2026-07-20");

		expect(vietnamDateISO(startDate)).toBe("2026-07-20");
		expect(vietnamDateISO(endDate)).toBe("2026-07-20");
		expect(vietnamDateISO(endDate + 1)).toBe("2026-07-21");
	});

	it("rolls the calendar date forward when UTC is still the previous day", () => {
		const lateUtcEvening = Date.UTC(2026, 0, 31, 20, 0, 0);

		expect(vietnamDateISO(lateUtcEvening)).toBe("2026-02-01");
		expect(VIETNAM_UTC_OFFSET_MS).toBe(25_200_000);
	});

	it("computes days ago relative to a given instant", () => {
		const now = Date.UTC(2026, 2, 1, 1, 0, 0);

		expect(vietnamDaysAgo(0, now)).toBe("2026-03-01");
		expect(vietnamDaysAgo(1, now)).toBe("2026-02-28");
	});
});
