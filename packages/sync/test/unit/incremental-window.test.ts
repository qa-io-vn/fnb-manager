import { describe, expect, it } from "vitest";
import { INCREMENTAL_DAYS, incrementalWindow } from "../../src/index.js";

const VIETNAM = { timezone: "Asia/Ho_Chi_Minh", business_day_start_minutes: 0 };

describe("incremental window", () => {
	it("covers the last three business days ending today in the store's timezone", () => {
		expect(INCREMENTAL_DAYS).toBe(3);
		expect(
			incrementalWindow(VIETNAM, new Date("2026-11-05T03:00:00.000Z")),
		).toEqual({ fromDate: "2026-11-03", toDate: "2026-11-05" });
	});

	it("moves to the next local day at local midnight, not at UTC midnight", () => {
		expect(
			incrementalWindow(VIETNAM, new Date("2026-11-05T16:59:00.000Z")),
		).toEqual({ fromDate: "2026-11-03", toDate: "2026-11-05" });
		expect(
			incrementalWindow(VIETNAM, new Date("2026-11-05T17:00:00.000Z")),
		).toEqual({ fromDate: "2026-11-04", toDate: "2026-11-06" });
	});

	it("keeps sales before the business-day start on the previous business date", () => {
		const lateNight = { ...VIETNAM, business_day_start_minutes: 300 };
		expect(
			incrementalWindow(lateNight, new Date("2026-11-05T21:30:00.000Z")),
		).toEqual({ fromDate: "2026-11-03", toDate: "2026-11-05" });
		expect(
			incrementalWindow(lateNight, new Date("2026-11-05T22:00:00.000Z")),
		).toEqual({ fromDate: "2026-11-04", toDate: "2026-11-06" });
	});

	it("follows a zone with daylight saving time", () => {
		const berlin = { timezone: "Europe/Berlin", business_day_start_minutes: 0 };
		expect(
			incrementalWindow(berlin, new Date("2026-03-28T23:30:00.000Z")),
		).toEqual({ fromDate: "2026-03-27", toDate: "2026-03-29" });
		expect(
			incrementalWindow(berlin, new Date("2026-03-29T21:59:00.000Z")),
		).toEqual({ fromDate: "2026-03-27", toDate: "2026-03-29" });
		expect(
			incrementalWindow(berlin, new Date("2026-03-29T22:00:00.000Z")),
		).toEqual({ fromDate: "2026-03-28", toDate: "2026-03-30" });
	});

	it("accepts another whole number of days and refuses anything else", () => {
		expect(
			incrementalWindow(VIETNAM, new Date("2026-11-05T03:00:00.000Z"), 1),
		).toEqual({ fromDate: "2026-11-05", toDate: "2026-11-05" });
		expect(() =>
			incrementalWindow(VIETNAM, new Date("2026-11-05T03:00:00.000Z"), 0),
		).toThrow(RangeError);
		expect(() =>
			incrementalWindow(VIETNAM, new Date("2026-11-05T03:00:00.000Z"), 1.5),
		).toThrow(RangeError);
	});
});
