import { describe, expect, it } from "vitest";
import {
	businessDate,
	businessDayEnd,
	businessDayStart,
	instantOnBusinessDate,
	isoDatesBetween,
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
