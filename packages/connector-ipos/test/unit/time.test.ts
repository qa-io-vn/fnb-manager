import { describe, expect, it } from "vitest";
import {
	MILLISECONDS_PER_DAY,
	sameCalendarMonth,
	splitRangeByCalendarMonth,
	VIETNAM_UTC_OFFSET_MS,
	vietnamDateISO,
	vietnamDayRange,
	vietnamDaysAgo,
	vietnamMidnight,
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

describe("splitRangeByCalendarMonth", () => {
	it("keeps a range inside one month as a single sub-range", () => {
		const range = vietnamRange("2026-10-08", "2026-10-31");
		expect(splitRangeByCalendarMonth(range)).toEqual([range]);
		expect(sameCalendarMonth(range)).toBe(true);
	});

	it("cuts a range spanning two months at local midnight on the first of the month", () => {
		const range = vietnamRange("2026-10-08", "2026-11-07");
		const novemberStart = vietnamMidnight("2026-11-01");
		expect(splitRangeByCalendarMonth(range)).toEqual([
			{ startDate: range.startDate, endDate: novemberStart - 1 },
			{ startDate: novemberStart, endDate: range.endDate },
		]);
		expect(sameCalendarMonth(range)).toBe(false);
	});

	it("crosses a year boundary and yields one sub-range per month touched", () => {
		const range = vietnamRange("2025-11-20", "2026-02-03");
		const parts = splitRangeByCalendarMonth(range);
		expect(parts).toHaveLength(4);
		expect(parts[0]?.startDate).toBe(range.startDate);
		expect(parts[1]?.startDate).toBe(vietnamMidnight("2025-12-01"));
		expect(parts[2]?.startDate).toBe(vietnamMidnight("2026-01-01"));
		expect(parts[3]).toEqual({
			startDate: vietnamMidnight("2026-02-01"),
			endDate: range.endDate,
		});
		for (let index = 1; index < parts.length; index += 1) {
			expect(parts[index]?.startDate).toBe(
				(parts[index - 1]?.endDate ?? 0) + 1,
			);
		}
	});

	it("splits by the calendar month of the given timezone", () => {
		const range = {
			startDate: Date.UTC(2026, 9, 31, 15),
			endDate: Date.UTC(2026, 9, 31, 20),
		};
		expect(splitRangeByCalendarMonth(range, "UTC")).toHaveLength(1);
		expect(splitRangeByCalendarMonth(range, "Asia/Ho_Chi_Minh")).toHaveLength(
			2,
		);
	});

	it("rejects an inverted range", () => {
		expect(() =>
			splitRangeByCalendarMonth({ startDate: 10, endDate: 5 }),
		).toThrow(RangeError);
	});
});
