import { daysBetween, isoWeekday, isoWeekKey, isoWeekOf } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	BAND_WINDOWS,
	calendarOf,
	KPI_WINDOWS,
	kpiWindowsOf,
	PACK_WINDOWS,
} from "../../src/pack/calendar.js";
import { DataPackError } from "../../src/pack/errors.js";
import { HORIZON_DAYS, HORIZONS } from "../../src/pack/request.js";
import { FIXTURE_CALENDAR } from "./fixture-calendar.js";

function length(range: { from: string; to: string }): number {
	return daysBetween(range.from, range.to) + 1;
}

describe("calendarOf", () => {
	it("derives every window of the fixture's as-of day", () => {
		expect(calendarOf("2026-11-11", "90d")).toEqual(FIXTURE_CALENDAR);
		expect(Object.keys(calendarOf("2026-11-11", "90d")).sort()).toEqual(
			[...PACK_WINDOWS].sort(),
		);
	});

	it("keeps w28, p28 and ly28 at 28 days, ly28 on the same weekdays 364 days back", () => {
		for (const asOf of [
			"2026-11-11",
			"2028-03-01",
			"2027-01-03",
			"2026-02-28",
		]) {
			const calendar = calendarOf(asOf, "90d");
			expect(length(calendar.w28)).toBe(28);
			expect(length(calendar.p28)).toBe(28);
			expect(length(calendar.ly28)).toBe(28);
			expect(calendar.w28.to).toBe(asOf);
			expect(daysBetween(calendar.p28.to, calendar.w28.from)).toBe(1);
			expect(daysBetween(calendar.ly28.from, calendar.w28.from)).toBe(364);
			expect(isoWeekday(calendar.ly28.from)).toBe(
				isoWeekday(calendar.w28.from),
			);
			expect(calendar.w84).toEqual({ from: calendar.band.from, to: asOf });
			expect(length(calendar.w84)).toBe(84);
		}
	});

	it("steps the eight band windows back 7 days at a time, b4 equal to p28", () => {
		const windows = kpiWindowsOf("2026-11-11");
		expect(KPI_WINDOWS).toEqual(["w28", "p28", "ly28", ...BAND_WINDOWS]);
		BAND_WINDOWS.forEach((name, index) => {
			expect(length(windows[name])).toBe(28);
			expect(daysBetween(windows[name].to, windows.w28.to)).toBe(
				7 * (index + 1),
			);
		});
		expect(windows.b4).toEqual(windows.p28);
		expect(windows.b8.from).toBe(calendarOf("2026-11-11", "30d").band.from);
	});

	it("crosses a leap day without losing a day", () => {
		const calendar = calendarOf("2028-03-01", "30d");
		expect(calendar.w28).toEqual({ from: "2028-02-03", to: "2028-03-01" });
		expect(calendar.ly28).toEqual({ from: "2027-02-04", to: "2027-03-03" });
		expect(calendar.months).toEqual({ from: "2025-12-01", to: "2028-02-29" });
		expect(calendar.month_to_date).toEqual({
			from: "2028-03-01",
			to: "2028-03-01",
		});
		const leapDay = calendarOf("2028-02-29", "30d");
		expect(leapDay.months.to).toBe("2028-02-29");
		expect(leapDay.month_to_date).toEqual({
			from: "2028-02-01",
			to: "2028-02-29",
		});
		expect(leapDay.horizon).toEqual({ from: "2028-03-01", to: "2028-03-30" });
	});

	it("counts the as-of month as complete when the as-of day ends it", () => {
		expect(calendarOf("2026-10-31", "90d").months).toEqual({
			from: "2024-08-01",
			to: "2026-10-31",
		});
		expect(calendarOf("2026-10-30", "90d").months).toEqual({
			from: "2024-07-01",
			to: "2026-09-30",
		});
		expect(calendarOf("2026-02-28", "90d").months).toEqual({
			from: "2023-12-01",
			to: "2026-02-28",
		});
		expect(calendarOf("2026-12-31", "90d").month_to_date).toEqual({
			from: "2026-12-01",
			to: "2026-12-31",
		});
	});

	it("ends the 13 weeks on the as-of day when it is a Sunday, else on the Sunday before", () => {
		const sunday = calendarOf("2026-11-08", "90d");
		expect(isoWeekday("2026-11-08")).toBe(7);
		expect(sunday.weeks).toEqual({ from: "2026-08-10", to: "2026-11-08" });
		const monday = calendarOf("2026-11-09", "90d");
		expect(monday.weeks).toEqual({ from: "2026-08-10", to: "2026-11-08" });
		const saturday = calendarOf("2026-11-14", "90d");
		expect(saturday.weeks).toEqual({ from: "2026-08-10", to: "2026-11-08" });
		for (const calendar of [sunday, monday, saturday]) {
			expect(isoWeekday(calendar.weeks.from)).toBe(1);
			expect(length(calendar.weeks)).toBe(91);
		}
	});

	it("includes 2026's week 53 when the weeks reach it", () => {
		const calendar = calendarOf("2027-01-03", "90d");
		expect(calendar.weeks.to).toBe("2027-01-03");
		expect(isoWeekKey(isoWeekOf(calendar.weeks.to))).toBe("2026-W53");
		const after = calendarOf("2027-01-10", "90d");
		expect(isoWeekKey(isoWeekOf(after.weeks.to))).toBe("2027-W01");
		expect(isoWeekKey(isoWeekOf(after.weeks.from))).toBe("2026-W42");
	});

	it("starts the horizon the day after the as-of day, as long as the horizon", () => {
		for (const horizon of HORIZONS) {
			const calendar = calendarOf("2026-11-11", horizon);
			expect(calendar.horizon.from).toBe("2026-11-12");
			expect(length(calendar.horizon)).toBe(HORIZON_DAYS[horizon]);
		}
		expect(calendarOf("2026-11-11", "12m").horizon.to).toBe("2027-11-11");
	});

	it("refuses a day that does not exist and an unknown horizon", () => {
		expect(() => calendarOf("2026-02-29", "90d")).toThrow(DataPackError);
		expect(() => calendarOf("2026-11-11T00:00:00Z", "90d")).toThrow(
			/^pack_invalid: /,
		);
		expect(() => calendarOf("2026-11-11", "7d" as never)).toThrow(
			/^pack_invalid: /,
		);
	});
});
