import { businessDayStart, isoDatesBetween, shiftIsoDate } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	closedStoreDays,
	STATUS_WINDOW_DAYS,
	type StatusWindow,
	type StoreClock,
	statusWindow,
} from "../../src/admin/status-window.js";

const VIETNAM: StoreClock = {
	timezone: "Asia/Ho_Chi_Minh",
	business_day_start_minutes: 0,
};
const LATE_START: StoreClock = {
	timezone: "Asia/Ho_Chi_Minh",
	business_day_start_minutes: 300,
};
const UTC_STORE: StoreClock = {
	timezone: "UTC",
	business_day_start_minutes: 0,
};
const NOON_IN_VIETNAM = new Date("2026-11-08T05:00:00Z");
const DAY_MS = 86_400_000;

function nightlyWindow(yesterday: string) {
	return { fromDate: shiftIsoDate(yesterday, -13), toDate: yesterday };
}

function closesInWindow(
	date: string,
	window: StatusWindow,
	store: StoreClock,
): boolean {
	const close = businessDayStart(
		shiftIsoDate(date, 1),
		store.timezone,
		store.business_day_start_minutes,
	);
	return close > window.since && close <= window.until;
}

describe("status window", () => {
	it("spans the 14 days ending now, for runs and store-days alike", () => {
		const window = statusWindow(NOON_IN_VIETNAM);
		expect(STATUS_WINDOW_DAYS).toBe(14);
		expect(window.days).toBe(14);
		expect(window.until).toEqual(NOON_IN_VIETNAM);
		expect(window.since).toEqual(
			new Date(NOON_IN_VIETNAM.getTime() - 14 * DAY_MS),
		);
	});

	it("counts the 14 business dates ending yesterday and never today", () => {
		const days = closedStoreDays(statusWindow(NOON_IN_VIETNAM), VIETNAM);
		expect(days).toEqual({ fromDate: "2026-10-25", toDate: "2026-11-07" });
		const dates = isoDatesBetween(days.fromDate, days.toDate);
		expect(dates).toHaveLength(14);
		expect(dates).not.toContain("2026-11-08");
	});

	it("covers exactly the dates the nightly sync of the same day covers", () => {
		const nightlyStart = new Date("2026-11-07T20:23:00Z");
		const nightly = nightlyWindow("2026-11-07");
		expect(closedStoreDays(statusWindow(nightlyStart), VIETNAM)).toEqual(
			nightly,
		);
		expect(closedStoreDays(statusWindow(NOON_IN_VIETNAM), VIETNAM)).toEqual(
			nightly,
		);
	});

	it("takes the store-days that closed inside the window that counts the runs", () => {
		for (const now of [
			NOON_IN_VIETNAM,
			new Date("2026-11-07T16:59:59.999Z"),
			new Date("2026-11-07T17:00:00Z"),
			new Date("2026-11-07T21:30:00Z"),
			new Date("2026-03-01T00:00:00Z"),
		]) {
			const window = statusWindow(now);
			for (const store of [VIETNAM, LATE_START, UTC_STORE]) {
				const days = closedStoreDays(window, store);
				for (const date of isoDatesBetween(
					shiftIsoDate(days.fromDate, -3),
					shiftIsoDate(days.toDate, 3),
				)) {
					expect(closesInWindow(date, window, store)).toBe(
						date >= days.fromDate && date <= days.toDate,
					);
				}
			}
		}
	});

	it("counts a run started today and drops one started more than 14 days ago", () => {
		const window = statusWindow(NOON_IN_VIETNAM);
		const nightlyRunToday = new Date("2026-11-07T20:23:00Z");
		const oldRun = new Date(window.since.getTime() - 60_000);
		expect(
			nightlyRunToday > window.since && nightlyRunToday <= window.until,
		).toBe(true);
		expect(oldRun > window.since).toBe(false);
	});

	it("moves to the next day at local midnight in the store's timezone", () => {
		expect(
			closedStoreDays(
				statusWindow(new Date("2026-11-07T16:59:59.999Z")),
				VIETNAM,
			),
		).toEqual({ fromDate: "2026-10-24", toDate: "2026-11-06" });
		expect(
			closedStoreDays(statusWindow(new Date("2026-11-07T17:00:00Z")), VIETNAM),
		).toEqual({ fromDate: "2026-10-25", toDate: "2026-11-07" });
		const utcEvening = statusWindow(new Date("2026-11-07T20:00:00Z"));
		expect(closedStoreDays(utcEvening, VIETNAM).toDate).toBe("2026-11-07");
		expect(closedStoreDays(utcEvening, UTC_STORE).toDate).toBe("2026-11-06");
	});

	it("keeps a business day open until the store's day start", () => {
		expect(
			closedStoreDays(
				statusWindow(new Date("2026-11-07T20:00:00Z")),
				LATE_START,
			),
		).toEqual({ fromDate: "2026-10-24", toDate: "2026-11-06" });
		expect(
			closedStoreDays(
				statusWindow(new Date("2026-11-07T22:00:00Z")),
				LATE_START,
			),
		).toEqual({ fromDate: "2026-10-25", toDate: "2026-11-07" });
	});
});
