import {
	addDays,
	addMonths,
	type DateRange,
	firstOfMonth,
	type IsoDate,
	isoWeekday,
	isValidIsoDate,
	lastOfMonth,
} from "@fnb/reports";
import { DataPackError } from "./errors.js";
import { KPI_WINDOW_DAYS } from "./kpi-ids.js";
import { HORIZON_DAYS, HORIZONS, type Horizon } from "./request.js";

export const PACK_WINDOWS = [
	"band",
	"horizon",
	"ly28",
	"month_to_date",
	"months",
	"p28",
	"w28",
	"w84",
	"weeks",
] as const;

export type PackWindowName = (typeof PACK_WINDOWS)[number];

export type PackCalendar = Readonly<Record<PackWindowName, DateRange>>;

export const LAST_YEAR_SHIFT_DAYS = 364;
export const BAND_WINDOW_COUNT = 8;
export const BAND_STEP_DAYS = 7;
export const W84_DAYS = 84;
export const WEEK_COUNT = 13;
export const MONTH_COUNT = 27;

export const BAND_WINDOWS = [
	"b1",
	"b2",
	"b3",
	"b4",
	"b5",
	"b6",
	"b7",
	"b8",
] as const;

export const KPI_WINDOWS = ["w28", "p28", "ly28", ...BAND_WINDOWS] as const;

export type KpiWindowName = (typeof KPI_WINDOWS)[number];

export type KpiWindows = Readonly<Record<KpiWindowName, DateRange>>;

const SUNDAY = 7;

function trailing(end: IsoDate, days: number): DateRange {
	return { from: addDays(end, -(days - 1)), to: end };
}

function shifted(range: DateRange, days: number): DateRange {
	return { from: addDays(range.from, days), to: addDays(range.to, days) };
}

function requireAsOf(asOf: IsoDate): void {
	if (typeof asOf !== "string" || !isValidIsoDate(asOf)) {
		throw new DataPackError("pack_invalid", `${String(asOf)} is not a date`);
	}
}

export function kpiWindowsOf(asOf: IsoDate): KpiWindows {
	requireAsOf(asOf);
	const w28 = trailing(asOf, KPI_WINDOW_DAYS);
	const windows: Record<string, DateRange> = {
		w28,
		p28: shifted(w28, -KPI_WINDOW_DAYS),
		ly28: shifted(w28, -LAST_YEAR_SHIFT_DAYS),
	};
	BAND_WINDOWS.forEach((name, index) => {
		windows[name] = shifted(w28, -BAND_STEP_DAYS * (index + 1));
	});
	return windows as KpiWindows;
}

function lastCompleteSunday(asOf: IsoDate): IsoDate {
	const weekday = isoWeekday(asOf);
	return weekday === SUNDAY ? asOf : addDays(asOf, -weekday);
}

function lastCompleteMonthEnd(asOf: IsoDate): IsoDate {
	return asOf === lastOfMonth(asOf) ? asOf : addDays(firstOfMonth(asOf), -1);
}

export function calendarOf(asOf: IsoDate, horizon: Horizon): PackCalendar {
	requireAsOf(asOf);
	if (!HORIZONS.includes(horizon)) {
		throw new DataPackError(
			"pack_invalid",
			`${String(horizon)} is not a horizon`,
		);
	}
	const kpi = kpiWindowsOf(asOf);
	const monthEnd = lastCompleteMonthEnd(asOf);
	return {
		band: { from: kpi.b8.from, to: kpi.w28.to },
		horizon: {
			from: addDays(asOf, 1),
			to: addDays(asOf, HORIZON_DAYS[horizon]),
		},
		ly28: kpi.ly28,
		month_to_date: { from: firstOfMonth(asOf), to: asOf },
		months: {
			from: addMonths(firstOfMonth(monthEnd), -(MONTH_COUNT - 1)),
			to: monthEnd,
		},
		p28: kpi.p28,
		w28: kpi.w28,
		w84: trailing(asOf, W84_DAYS),
		weeks: trailing(lastCompleteSunday(asOf), WEEK_COUNT * 7),
	};
}
