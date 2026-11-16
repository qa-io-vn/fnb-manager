import { type HolidayEntry, VIETNAM_HOLIDAYS } from "@fnb/core";
import type { MessageKey } from "../../i18n";
import type { IsoDate } from "../../lib/business-dates";
import { type HolidayChange, type HolidayRow, yearBounds } from "../source";
import {
	dateWithin,
	holidayName,
	holidayNameValueOf,
	issueOf,
	type ValidationIssue,
} from "../validation";

export const HOLIDAY_FIRST_YEAR = 2024;
export const HOLIDAY_LAST_YEAR = 2030;

export const HOLIDAY_YEARS: readonly number[] = Array.from(
	{ length: HOLIDAY_LAST_YEAR - HOLIDAY_FIRST_YEAR + 1 },
	(_, offset) => HOLIDAY_FIRST_YEAR + offset,
);

export const HOLIDAY_DATE_BOUNDS: {
	readonly min: IsoDate;
	readonly max: IsoDate;
} = {
	min: yearBounds(HOLIDAY_FIRST_YEAR).from,
	max: yearBounds(HOLIDAY_LAST_YEAR).to,
};

export function holidayYearOf(date: IsoDate): number {
	return Number(date.slice(0, 4));
}

export function defaultHolidayYear(today: IsoDate): number {
	return Math.min(
		Math.max(holidayYearOf(today), HOLIDAY_FIRST_YEAR),
		HOLIDAY_LAST_YEAR,
	);
}

export function nationalCalendarYears(
	holidays: readonly HolidayEntry[] = VIETNAM_HOLIDAYS,
): { readonly from: number; readonly to: number } {
	const years = holidays.map((holiday) => holidayYearOf(holiday.holidayDate));
	if (years.length === 0) {
		return { from: HOLIDAY_FIRST_YEAR, to: HOLIDAY_FIRST_YEAR };
	}
	return { from: Math.min(...years), to: Math.max(...years) };
}

export const NATIONAL_CALENDAR_YEARS = nationalCalendarYears();

const GLOBAL_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
	"New Year's Day": "settings.holidays.name.newYear",
	"Tet, 29th of the last lunar month": "settings.holidays.name.tetDay29",
	"Tet, last day of the lunar year": "settings.holidays.name.tetEve",
	"Tet, day 1": "settings.holidays.name.tetDay1",
	"Tet, day 2": "settings.holidays.name.tetDay2",
	"Tet, day 3": "settings.holidays.name.tetDay3",
	"Tet, day 4": "settings.holidays.name.tetDay4",
	"Tet, day 5": "settings.holidays.name.tetDay5",
	"Hung Kings Commemoration Day": "settings.holidays.name.hungKings",
	"Reunification Day": "settings.holidays.name.reunification",
	"International Labour Day": "settings.holidays.name.labourDay",
	"National Day": "settings.holidays.name.nationalDay",
	"National Day adjacent holiday": "settings.holidays.name.nationalDayAdjacent",
};

export function globalHolidayNameKey(name: string): MessageKey | null {
	return Object.hasOwn(GLOBAL_NAME_KEYS, name)
		? (GLOBAL_NAME_KEYS[name] ?? null)
		: null;
}

const KIND_KEYS: Readonly<Record<string, MessageKey>> = {
	public: "report.holiday.public",
	tet: "report.holiday.tet",
	custom: "report.holiday.custom",
};

export function holidayKindKey(kind: string): MessageKey | null {
	return Object.hasOwn(KIND_KEYS, kind) ? (KIND_KEYS[kind] ?? null) : null;
}

export interface HolidayDraft {
	readonly date: string;
	readonly name: string;
}

export const EMPTY_HOLIDAY_DRAFT: HolidayDraft = { date: "", name: "" };

export interface HolidayDraftReading {
	readonly change: HolidayChange | null;
	readonly dateIssue: ValidationIssue | null;
	readonly nameIssue: ValidationIssue | null;
	readonly exists: boolean;
}

const holidayDate = dateWithin(HOLIDAY_DATE_BOUNDS);

export function readHolidayDraft(
	draft: HolidayDraft,
	known: readonly HolidayRow[],
): HolidayDraftReading {
	const dateIssue =
		draft.date === ""
			? { key: "required" as const }
			: issueOf(holidayDate, draft.date, "date");
	const nameIssue = issueOf(holidayName, draft.name, "required");
	if (dateIssue !== null || nameIssue !== null) {
		return { change: null, dateIssue, nameIssue, exists: false };
	}
	const name = holidayNameValueOf(draft.name);
	const exists = known.some(
		(row) =>
			row.custom &&
			row.holidayDate === draft.date &&
			holidayNameValueOf(row.name) === name,
	);
	return {
		change: exists ? null : { holidayDate: draft.date, name },
		dateIssue: null,
		nameIssue: null,
		exists,
	};
}

export function holidayOrder(left: HolidayRow, right: HolidayRow): number {
	return (
		left.holidayDate.localeCompare(right.holidayDate) ||
		Number(left.custom) - Number(right.custom) ||
		left.id.localeCompare(right.id)
	);
}

export function withAddedHoliday(
	rows: readonly HolidayRow[] | undefined,
	added: HolidayRow,
): HolidayRow[] | undefined {
	if (rows === undefined) return undefined;
	return [...rows.filter((row) => row.id !== added.id), added].sort(
		holidayOrder,
	);
}

export function withoutHoliday(
	rows: readonly HolidayRow[] | undefined,
	id: string,
): HolidayRow[] | undefined {
	return rows?.filter((row) => row.id !== id);
}
