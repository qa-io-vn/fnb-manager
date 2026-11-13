import { formatIsoDate } from "@fnb/core";
import type { IsoDate } from "../contract/values.js";
import {
	addDays,
	daysBetween,
	firstOfMonth,
	isValidIsoDate,
	lastOfMonth,
	minDate,
	yearOf,
} from "./dates.js";
import {
	isoWeekKey,
	isoWeekOf,
	isoWeeksInYear,
	mondayOf,
	mondayOfIsoWeek,
} from "./iso-week.js";

export type ReportKind = "day" | "week" | "month" | "year";

export const REPORT_KINDS: readonly ReportKind[] = [
	"day",
	"week",
	"month",
	"year",
];

export const FIRST_CALENDAR_DATE = "2023-01-01";

export interface ReportPeriod {
	readonly kind: ReportKind;
	readonly key: string;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly end: IsoDate;
	readonly asOf: IsoDate;
	readonly complete: boolean;
	readonly elapsedDays: number;
	readonly totalDays: number;
}

interface PeriodRange {
	readonly key: string;
	readonly from: IsoDate;
	readonly to: IsoDate;
}

function rangeContaining(kind: ReportKind, date: IsoDate): PeriodRange {
	switch (kind) {
		case "day":
			return { key: date, from: date, to: date };
		case "week": {
			const from = mondayOf(date);
			return { key: isoWeekKey(isoWeekOf(date)), from, to: addDays(from, 6) };
		}
		case "month": {
			const from = firstOfMonth(date);
			return { key: from.slice(0, 7), from, to: lastOfMonth(date) };
		}
		case "year": {
			const year = yearOf(date);
			return {
				key: String(year).padStart(4, "0"),
				from: formatIsoDate(year, 1, 1),
				to: formatIsoDate(year, 12, 31),
			};
		}
	}
}

function periodOf(
	kind: ReportKind,
	range: PeriodRange,
	asOf: IsoDate,
): ReportPeriod {
	const end = minDate(range.to, asOf);
	return {
		kind,
		key: range.key,
		from: range.from,
		to: range.to,
		end,
		asOf,
		complete: end === range.to,
		elapsedDays: daysBetween(range.from, end) + 1,
		totalDays: daysBetween(range.from, range.to) + 1,
	};
}

export function periodContaining(
	kind: ReportKind,
	date: IsoDate,
	asOf: IsoDate,
): ReportPeriod {
	return periodOf(kind, rangeContaining(kind, date), asOf);
}

export function isValidPeriod(
	period: Pick<ReportPeriod, "from" | "to" | "asOf">,
): boolean {
	return period.from <= period.asOf && period.to >= FIRST_CALENDAR_DATE;
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_KEY = /^(\d{4})-W(\d{2})$/;
const MONTH_KEY = /^(\d{4})-(\d{2})$/;
const YEAR_KEY = /^(\d{4})$/;

function rangeOfKey(kind: ReportKind, key: string): PeriodRange | null {
	switch (kind) {
		case "day":
			return DAY_KEY.test(key) && isValidIsoDate(key)
				? rangeContaining("day", key)
				: null;
		case "week": {
			const match = WEEK_KEY.exec(key);
			if (!match) return null;
			const isoYear = Number(match[1]);
			const isoWeek = Number(match[2]);
			if (isoWeek < 1 || isoWeek > isoWeeksInYear(isoYear)) return null;
			return rangeContaining("week", mondayOfIsoWeek(isoYear, isoWeek));
		}
		case "month": {
			const match = MONTH_KEY.exec(key);
			if (!match) return null;
			const month = Number(match[2]);
			if (month < 1 || month > 12) return null;
			return rangeContaining(
				"month",
				formatIsoDate(Number(match[1]), month, 1),
			);
		}
		case "year": {
			const match = YEAR_KEY.exec(key);
			if (!match) return null;
			return rangeContaining("year", formatIsoDate(Number(match[1]), 1, 1));
		}
	}
}

export function periodKey(kind: ReportKind, date: IsoDate): string {
	return rangeContaining(kind, date).key;
}

export function parsePeriodKey(
	kind: ReportKind,
	key: string,
	asOf: IsoDate,
): ReportPeriod | null {
	const range = rangeOfKey(kind, key);
	if (range === null || range.to < FIRST_CALENDAR_DATE) {
		return null;
	}
	if (range.from > asOf) {
		return periodContaining(kind, asOf, asOf);
	}
	return periodOf(kind, range, asOf);
}

export function stepPeriod(
	period: ReportPeriod,
	step: -1 | 1,
): ReportPeriod | null {
	const date = step < 0 ? addDays(period.from, -1) : addDays(period.to, 1);
	const next = periodContaining(period.kind, date, period.asOf);
	return isValidPeriod(next) ? next : null;
}

export function switchKind(
	period: ReportPeriod,
	kind: ReportKind,
): ReportPeriod {
	return periodContaining(kind, period.end, period.asOf);
}

export function rangeOfPeriodKey(
	kind: ReportKind,
	key: string,
): { readonly from: IsoDate; readonly to: IsoDate } | null {
	const range = rangeOfKey(kind, key);
	return range === null ? null : { from: range.from, to: range.to };
}

export function isFuturePeriodKey(
	kind: ReportKind,
	key: string,
	asOf: IsoDate,
): boolean {
	const range = rangeOfKey(kind, key);
	return range !== null && range.from > asOf;
}
