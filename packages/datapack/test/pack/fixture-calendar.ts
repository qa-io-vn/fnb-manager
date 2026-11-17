import type { PackCalendar } from "../../src/pack/calendar.js";

export const UNAVAILABLE_AS_OF = "1999-12-31";

function range(from: string, to: string) {
	return { from, to };
}

export const FIXTURE_CALENDAR: PackCalendar = {
	band: range("2026-08-20", "2026-11-11"),
	horizon: range("2026-11-12", "2027-02-09"),
	ly28: range("2025-10-16", "2025-11-12"),
	month_to_date: range("2026-11-01", "2026-11-11"),
	months: range("2024-08-01", "2026-10-31"),
	p28: range("2026-09-17", "2026-10-14"),
	w28: range("2026-10-15", "2026-11-11"),
	w84: range("2026-08-20", "2026-11-11"),
	weeks: range("2026-08-10", "2026-11-08"),
};

export function fixtureCalendarOf(asOf: string): PackCalendar {
	if (asOf === UNAVAILABLE_AS_OF) throw new RangeError("no calendar");
	return FIXTURE_CALENDAR;
}
