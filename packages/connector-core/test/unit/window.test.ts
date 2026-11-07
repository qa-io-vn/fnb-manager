import { describe, expect, it } from "vitest";
import {
	isWithinWindow,
	singleDayWindow,
	splitWindow,
	windowDates,
	windowInstants,
} from "../../src/index.js";

const vietnamStore = { timezone: "Asia/Ho_Chi_Minh", dayStartMinutes: 0 };
const lateStore = { timezone: "Asia/Ho_Chi_Minh", dayStartMinutes: 5 * 60 };

describe("windowInstants", () => {
	it("covers local midnight to the last millisecond of the last day", () => {
		const range = windowInstants(
			{ fromDate: "2026-11-01", toDate: "2026-11-07" },
			vietnamStore,
		);
		expect(range.from.toISOString()).toBe("2026-10-31T17:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-11-07T16:59:59.999Z");
	});

	it("shifts both edges by the day start", () => {
		const range = windowInstants(singleDayWindow("2026-11-07"), lateStore);
		expect(range.from.toISOString()).toBe("2026-11-06T22:00:00.000Z");
		expect(range.to.toISOString()).toBe("2026-11-07T21:59:59.999Z");
	});

	it("rejects reversed and malformed windows", () => {
		expect(() =>
			windowInstants(
				{ fromDate: "2026-11-08", toDate: "2026-11-07" },
				vietnamStore,
			),
		).toThrow(RangeError);
		expect(() =>
			windowInstants(
				{ fromDate: "2026-11-7", toDate: "2026-11-07" },
				vietnamStore,
			),
		).toThrow(RangeError);
	});
});

describe("window helpers", () => {
	it("lists the dates of a window inclusively", () => {
		expect(
			windowDates({ fromDate: "2026-01-30", toDate: "2026-02-01" }),
		).toEqual(["2026-01-30", "2026-01-31", "2026-02-01"]);
	});

	it("splits a window into chunks of at most n days", () => {
		expect(
			splitWindow({ fromDate: "2026-01-01", toDate: "2026-01-07" }, 3),
		).toEqual([
			{ fromDate: "2026-01-01", toDate: "2026-01-03" },
			{ fromDate: "2026-01-04", toDate: "2026-01-06" },
			{ fromDate: "2026-01-07", toDate: "2026-01-07" },
		]);
		expect(() =>
			splitWindow({ fromDate: "2026-01-01", toDate: "2026-01-07" }, 0),
		).toThrow(RangeError);
	});

	it("tests membership inclusively", () => {
		const window = { fromDate: "2026-01-01", toDate: "2026-01-07" };
		expect(isWithinWindow("2026-01-01", window)).toBe(true);
		expect(isWithinWindow("2026-01-07", window)).toBe(true);
		expect(isWithinWindow("2026-01-08", window)).toBe(false);
		expect(isWithinWindow("2025-12-31", window)).toBe(false);
	});
});
