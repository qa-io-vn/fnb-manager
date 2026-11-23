import { afterEach, describe, expect, it, vi } from "vitest";
import {
	businessDate,
	businessDayEnd,
	businessDayStart,
	formattedWallClock,
	instantOnBusinessDate,
	isoDatesBetween,
	parseIsoDate,
	shiftIsoDate,
	wallClockIn,
	zonedInstant,
} from "../../src/index.js";

const VIETNAM = "Asia/Ho_Chi_Minh";
const NEW_YORK = "America/New_York";
const DAY_START_FIVE = 5 * 60;

describe("businessDate", () => {
	it("keeps 23:30 local on the same date although UTC is still the previous day", () => {
		const instant = new Date(Date.UTC(2026, 10, 7, 16, 30));
		expect(wallClockIn(instant, VIETNAM)).toMatchObject({
			hour: 23,
			minute: 30,
		});
		expect(businessDate(instant, VIETNAM, 0)).toBe("2026-11-07");
	});

	it("keeps 23:30 local on the same date although UTC is already the next day", () => {
		const instant = new Date(Date.UTC(2026, 10, 8, 4, 30));
		expect(wallClockIn(instant, NEW_YORK)).toMatchObject({
			hour: 23,
			minute: 30,
		});
		expect(businessDate(instant, NEW_YORK, 0)).toBe("2026-11-07");
	});

	it("puts 00:30 on the previous business date when the day starts at 05:00", () => {
		const instant = new Date(Date.UTC(2026, 10, 7, 17, 30));
		expect(wallClockIn(instant, VIETNAM)).toMatchObject({
			hour: 0,
			minute: 30,
		});
		expect(businessDate(instant, VIETNAM, DAY_START_FIVE)).toBe("2026-11-07");
		expect(businessDate(instant, VIETNAM, 0)).toBe("2026-11-08");
	});

	it("starts the new business date exactly at the day start minute", () => {
		const atStart = new Date(Date.UTC(2026, 10, 7, 22, 0));
		const justBefore = new Date(atStart.getTime() - 1);
		expect(businessDate(atStart, VIETNAM, DAY_START_FIVE)).toBe("2026-11-08");
		expect(businessDate(justBefore, VIETNAM, DAY_START_FIVE)).toBe(
			"2026-11-07",
		);
	});

	it("follows a store in another timezone across its own midnight", () => {
		const beforeMidnight = new Date(Date.UTC(2026, 6, 15, 3, 59));
		const afterMidnight = new Date(Date.UTC(2026, 6, 15, 4, 1));
		expect(businessDate(beforeMidnight, NEW_YORK, 0)).toBe("2026-07-14");
		expect(businessDate(afterMidnight, NEW_YORK, 0)).toBe("2026-07-15");
		expect(businessDate(afterMidnight, VIETNAM, 0)).toBe("2026-07-15");
	});

	it("rolls over a month and a year boundary", () => {
		expect(
			businessDate(new Date(Date.UTC(2025, 11, 31, 17, 0)), VIETNAM, 0),
		).toBe("2026-01-01");
		expect(
			businessDate(new Date(Date.UTC(2025, 11, 31, 17, 0)), VIETNAM, 60),
		).toBe("2025-12-31");
	});

	it("rejects an unknown timezone and a day start outside a day", () => {
		expect(() => businessDate(new Date(), "Mars/Olympus", 0)).toThrow(
			RangeError,
		);
		expect(() => businessDate(new Date(), VIETNAM, 1440)).toThrow(RangeError);
		expect(() => businessDate(new Date(), VIETNAM, -1)).toThrow(RangeError);
	});
});

describe("zonedInstant and business day bounds", () => {
	it("maps a local wall clock to the right instant", () => {
		expect(
			zonedInstant("2026-11-07", 23 * 60 + 30, VIETNAM).toISOString(),
		).toBe("2026-11-07T16:30:00.000Z");
		expect(
			zonedInstant("2026-11-07", 23 * 60 + 30, NEW_YORK).toISOString(),
		).toBe("2026-11-08T04:30:00.000Z");
	});

	it("handles a daylight-saving transition day", () => {
		expect(zonedInstant("2026-03-08", 12 * 60, NEW_YORK).toISOString()).toBe(
			"2026-03-08T16:00:00.000Z",
		);
		expect(zonedInstant("2026-03-07", 12 * 60, NEW_YORK).toISOString()).toBe(
			"2026-03-07T17:00:00.000Z",
		);
	});

	// Each expected instant is what PostgreSQL gives for
	// (date + time)::timestamp at time zone tz (checked on the local stack,
	// 2026-11-23): a skipped wall clock is read with the offset before the
	// change, a wall clock that occurs twice is its later instant.
	it.each([
		{
			label: "gap: Santiago skips midnight",
			date: "2026-09-06",
			minutes: 0,
			tz: "America/Santiago",
			utc: "2026-09-06T04:00:00.000Z",
		},
		{
			label: "gap: Havana skips midnight",
			date: "2026-03-08",
			minutes: 0,
			tz: "America/Havana",
			utc: "2026-03-08T05:00:00.000Z",
		},
		{
			label: "overlap: Havana's midnight occurs twice",
			date: "2026-11-01",
			minutes: 0,
			tz: "America/Havana",
			utc: "2026-11-01T05:00:00.000Z",
		},
		{
			label: "overlap: Santiago's 23:30 occurs twice",
			date: "2026-04-04",
			minutes: 23 * 60 + 30,
			tz: "America/Santiago",
			utc: "2026-04-05T03:30:00.000Z",
		},
		{
			label: "gap: New York skips 02:30",
			date: "2026-03-08",
			minutes: 150,
			tz: NEW_YORK,
			utc: "2026-03-08T07:30:00.000Z",
		},
		{
			label: "overlap: New York's 01:30 occurs twice",
			date: "2026-11-01",
			minutes: 90,
			tz: NEW_YORK,
			utc: "2026-11-01T06:30:00.000Z",
		},
		{
			label: "gap: London skips 01:30",
			date: "2026-03-29",
			minutes: 90,
			tz: "Europe/London",
			utc: "2026-03-29T01:30:00.000Z",
		},
		{
			label: "overlap: London's 01:30 occurs twice",
			date: "2026-10-25",
			minutes: 90,
			tz: "Europe/London",
			utc: "2026-10-25T01:30:00.000Z",
		},
		{
			label: "no change: Santiago's midnight after the change back",
			date: "2027-04-04",
			minutes: 0,
			tz: "America/Santiago",
			utc: "2027-04-04T04:00:00.000Z",
		},
		{
			label: "no change: Ho Chi Minh City's midnight",
			date: "2026-11-20",
			minutes: 0,
			tz: VIETNAM,
			utc: "2026-11-19T17:00:00.000Z",
		},
	])(
		"reads a wall clock as PostgreSQL does at a change of offset ($label)",
		({ date, minutes, tz, utc }) => {
			expect(zonedInstant(date, minutes, tz).toISOString()).toBe(utc);
		},
	);

	it("bounds a business day from its day start to the instant before the next", () => {
		const start = businessDayStart("2026-11-07", VIETNAM, DAY_START_FIVE);
		const end = businessDayEnd("2026-11-07", VIETNAM, DAY_START_FIVE);
		expect(start.toISOString()).toBe("2026-11-06T22:00:00.000Z");
		expect(end.toISOString()).toBe("2026-11-07T21:59:59.999Z");
		expect(businessDate(start, VIETNAM, DAY_START_FIVE)).toBe("2026-11-07");
		expect(businessDate(end, VIETNAM, DAY_START_FIVE)).toBe("2026-11-07");
		expect(
			businessDate(new Date(end.getTime() + 1), VIETNAM, DAY_START_FIVE),
		).toBe("2026-11-08");
	});

	it("places a wall clock before the day start on the next calendar day", () => {
		const instant = instantOnBusinessDate(
			"2026-11-07",
			30,
			VIETNAM,
			DAY_START_FIVE,
		);
		expect(instant.toISOString()).toBe("2026-11-07T17:30:00.000Z");
		expect(businessDate(instant, VIETNAM, DAY_START_FIVE)).toBe("2026-11-07");
		expect(
			instantOnBusinessDate(
				"2026-11-07",
				9 * 60,
				VIETNAM,
				DAY_START_FIVE,
			).toISOString(),
		).toBe("2026-11-07T02:00:00.000Z");
	});
});

describe("ISO date helpers", () => {
	it("shifts across month ends and leap days", () => {
		expect(shiftIsoDate("2026-02-28", 1)).toBe("2026-03-01");
		expect(shiftIsoDate("2028-02-28", 1)).toBe("2028-02-29");
		expect(shiftIsoDate("2026-01-01", -1)).toBe("2025-12-31");
	});

	it("lists inclusive dates", () => {
		expect(isoDatesBetween("2026-01-30", "2026-02-02")).toEqual([
			"2026-01-30",
			"2026-01-31",
			"2026-02-01",
			"2026-02-02",
		]);
		expect(isoDatesBetween("2026-02-02", "2026-02-01")).toEqual([]);
	});

	it("rejects malformed dates", () => {
		expect(() => shiftIsoDate("2026-02-30", 0)).toThrow(RangeError);
		expect(() => shiftIsoDate("07/11/2026", 0)).toThrow(RangeError);
	});
});

const MINUTE_MS = 60_000;

function minutesOfUtcDay(year: number, month: number, day: number): Date[] {
	const start = Date.UTC(year, month - 1, day);
	return Array.from(
		{ length: 24 * 60 },
		(_, minute) => new Date(start + minute * MINUTE_MS),
	);
}

describe("wall clocks from a day's offset", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("reads every minute of a day without a transition with two Intl lookups", () => {
		const lookups = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
		const minutes = minutesOfUtcDay(2027, 2, 3);
		const clocks = minutes.map((instant) =>
			wallClockIn(instant, "Asia/Kathmandu"),
		);
		expect(lookups).toHaveBeenCalledTimes(2);
		lookups.mockRestore();
		minutes.forEach((instant, index) => {
			expect(clocks[index]).toEqual(
				formattedWallClock(instant, "Asia/Kathmandu"),
			);
		});
	});

	it("stays exact on both daylight-saving days of a year, minute by minute", () => {
		for (const [month, day] of [
			[3, 8],
			[11, 1],
		] as const) {
			for (const instant of minutesOfUtcDay(2026, month, day)) {
				expect(wallClockIn(instant, NEW_YORK)).toEqual(
					formattedWallClock(instant, NEW_YORK),
				);
			}
		}
	});
});

describe("parseIsoDate", () => {
	it("hands out a fresh object for a date it has seen before", () => {
		const first = parseIsoDate("2026-02-28");
		first.day = 1;
		expect(parseIsoDate("2026-02-28")).toEqual({
			year: 2026,
			month: 2,
			day: 28,
		});
	});
});
