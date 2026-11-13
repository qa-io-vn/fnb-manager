import { MILLISECONDS_PER_DAY, parseIsoDate } from "../rules/business-date.js";

export type HolidayKind = "public" | "tet" | "custom";

export interface HolidayEntry {
	readonly holidayDate: string;
	readonly name: string;
	readonly kind: HolidayKind;
}

export const TET_WINDOW_MAX_SPAN_DAYS = 14;

export const VIETNAM_HOLIDAYS: readonly HolidayEntry[] = [
	{ holidayDate: "2024-01-01", name: "New Year's Day", kind: "public" },
	{
		holidayDate: "2024-02-08",
		name: "Tet, 29th of the last lunar month",
		kind: "tet",
	},
	{
		holidayDate: "2024-02-09",
		name: "Tet, last day of the lunar year",
		kind: "tet",
	},
	{ holidayDate: "2024-02-10", name: "Tet, day 1", kind: "tet" },
	{ holidayDate: "2024-02-11", name: "Tet, day 2", kind: "tet" },
	{ holidayDate: "2024-02-12", name: "Tet, day 3", kind: "tet" },
	{ holidayDate: "2024-02-13", name: "Tet, day 4", kind: "tet" },
	{ holidayDate: "2024-02-14", name: "Tet, day 5", kind: "tet" },
	{
		holidayDate: "2024-04-18",
		name: "Hung Kings Commemoration Day",
		kind: "public",
	},
	{ holidayDate: "2024-04-30", name: "Reunification Day", kind: "public" },
	{
		holidayDate: "2024-05-01",
		name: "International Labour Day",
		kind: "public",
	},
	{ holidayDate: "2024-09-02", name: "National Day", kind: "public" },
	{
		holidayDate: "2024-09-03",
		name: "National Day adjacent holiday",
		kind: "public",
	},
	{ holidayDate: "2025-01-01", name: "New Year's Day", kind: "public" },
	{
		holidayDate: "2025-01-28",
		name: "Tet, last day of the lunar year",
		kind: "tet",
	},
	{ holidayDate: "2025-01-29", name: "Tet, day 1", kind: "tet" },
	{ holidayDate: "2025-01-30", name: "Tet, day 2", kind: "tet" },
	{ holidayDate: "2025-01-31", name: "Tet, day 3", kind: "tet" },
	{ holidayDate: "2025-02-01", name: "Tet, day 4", kind: "tet" },
	{ holidayDate: "2025-02-02", name: "Tet, day 5", kind: "tet" },
	{
		holidayDate: "2025-04-07",
		name: "Hung Kings Commemoration Day",
		kind: "public",
	},
	{ holidayDate: "2025-04-30", name: "Reunification Day", kind: "public" },
	{
		holidayDate: "2025-05-01",
		name: "International Labour Day",
		kind: "public",
	},
	{
		holidayDate: "2025-09-01",
		name: "National Day adjacent holiday",
		kind: "public",
	},
	{ holidayDate: "2025-09-02", name: "National Day", kind: "public" },
	{ holidayDate: "2026-01-01", name: "New Year's Day", kind: "public" },
	{
		holidayDate: "2026-02-16",
		name: "Tet, last day of the lunar year",
		kind: "tet",
	},
	{ holidayDate: "2026-02-17", name: "Tet, day 1", kind: "tet" },
	{ holidayDate: "2026-02-18", name: "Tet, day 2", kind: "tet" },
	{ holidayDate: "2026-02-19", name: "Tet, day 3", kind: "tet" },
	{ holidayDate: "2026-02-20", name: "Tet, day 4", kind: "tet" },
	{ holidayDate: "2026-02-21", name: "Tet, day 5", kind: "tet" },
	{
		holidayDate: "2026-04-26",
		name: "Hung Kings Commemoration Day",
		kind: "public",
	},
	{ holidayDate: "2026-04-30", name: "Reunification Day", kind: "public" },
	{
		holidayDate: "2026-05-01",
		name: "International Labour Day",
		kind: "public",
	},
	{
		holidayDate: "2026-09-01",
		name: "National Day adjacent holiday",
		kind: "public",
	},
	{ holidayDate: "2026-09-02", name: "National Day", kind: "public" },
	{ holidayDate: "2027-01-01", name: "New Year's Day", kind: "public" },
	{
		holidayDate: "2027-02-05",
		name: "Tet, last day of the lunar year",
		kind: "tet",
	},
	{ holidayDate: "2027-02-06", name: "Tet, day 1", kind: "tet" },
	{ holidayDate: "2027-02-07", name: "Tet, day 2", kind: "tet" },
	{ holidayDate: "2027-02-08", name: "Tet, day 3", kind: "tet" },
	{ holidayDate: "2027-02-09", name: "Tet, day 4", kind: "tet" },
	{ holidayDate: "2027-02-10", name: "Tet, day 5", kind: "tet" },
	{
		holidayDate: "2027-04-16",
		name: "Hung Kings Commemoration Day",
		kind: "public",
	},
	{ holidayDate: "2027-04-30", name: "Reunification Day", kind: "public" },
	{
		holidayDate: "2027-05-01",
		name: "International Labour Day",
		kind: "public",
	},
	{ holidayDate: "2027-09-02", name: "National Day", kind: "public" },
	{
		holidayDate: "2027-09-03",
		name: "National Day adjacent holiday",
		kind: "public",
	},
	{ holidayDate: "2028-01-01", name: "New Year's Day", kind: "public" },
	{
		holidayDate: "2028-01-25",
		name: "Tet, last day of the lunar year",
		kind: "tet",
	},
	{ holidayDate: "2028-01-26", name: "Tet, day 1", kind: "tet" },
	{ holidayDate: "2028-01-27", name: "Tet, day 2", kind: "tet" },
	{ holidayDate: "2028-01-28", name: "Tet, day 3", kind: "tet" },
	{ holidayDate: "2028-01-29", name: "Tet, day 4", kind: "tet" },
	{ holidayDate: "2028-01-30", name: "Tet, day 5", kind: "tet" },
	{
		holidayDate: "2028-04-04",
		name: "Hung Kings Commemoration Day",
		kind: "public",
	},
	{ holidayDate: "2028-04-30", name: "Reunification Day", kind: "public" },
	{
		holidayDate: "2028-05-01",
		name: "International Labour Day",
		kind: "public",
	},
	{
		holidayDate: "2028-09-01",
		name: "National Day adjacent holiday",
		kind: "public",
	},
	{ holidayDate: "2028-09-02", name: "National Day", kind: "public" },
];

function dayNumber(date: string): number {
	const { year, month, day } = parseIsoDate(date);
	return Date.UTC(year, month - 1, day) / MILLISECONDS_PER_DAY;
}

export function isHolidayDate(
	holidays: readonly HolidayEntry[],
	date: string,
): boolean {
	return holidays.some((holiday) => holiday.holidayDate === date);
}

export function isTetWindowDate(
	holidays: readonly HolidayEntry[],
	date: string,
): boolean {
	const target = dayNumber(date);
	const tetDays = holidays
		.filter((holiday) => holiday.kind === "tet")
		.map((holiday) => dayNumber(holiday.holidayDate));
	return tetDays.some(
		(first) =>
			first <= target &&
			tetDays.some(
				(last) => last >= target && last - first <= TET_WINDOW_MAX_SPAN_DAYS,
			),
	);
}

export function isExcludedDay(
	holidays: readonly HolidayEntry[],
	date: string,
): boolean {
	return isHolidayDate(holidays, date) || isTetWindowDate(holidays, date);
}
