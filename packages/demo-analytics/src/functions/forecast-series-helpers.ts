import type { HolidayEntry } from "@fnb/core";
import {
	addDays,
	datesBetween,
	daysBetween,
	type IsoDate,
	isoWeekday,
	minDate,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money, PgDecimal } from "../pg-numeric.js";
import { dailySales, isExcludedFor } from "./support.js";

export const PROFILE_HISTORY_DAYS = 84;
export const PROFILE_LEVEL_DAYS = 28;
export const SEASONAL_NAIVE_DAYS = 56;
export const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

const DAYS_PER_WEEK = 7;
const FORECAST_DIGITS = 2;

export interface DailyNetPoint {
	readonly date: IsoDate;
	readonly net: PgDecimal;
	readonly excluded: boolean;
}

export interface WeekdayProfileEntry {
	readonly weekday: number;
	readonly level: PgDecimal | null;
	readonly index: PgDecimal | null;
}

export interface SeasonalNaivePoint {
	readonly targetDate: IsoDate;
	readonly forecast: PgDecimal | null;
}

export function dailyNetSeries(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
	holidays: readonly HolidayEntry[],
): DailyNetPoint[] {
	const netByDate = new Map<IsoDate, number>();
	for (const row of dailySales(store, storeIds, from, to)) {
		netByDate.set(
			row.date,
			(netByDate.get(row.date) ?? 0) + row.daily.netMinor,
		);
	}
	return [...netByDate.keys()].sort().map((date) => ({
		date,
		net: money(netByDate.get(date) ?? 0),
		excluded: isExcludedFor(store, storeIds, date, holidays),
	}));
}

function averageOf(points: readonly DailyNetPoint[]): PgDecimal | null {
	return PgDecimal.avg(points.map((point) => point.net));
}

export function weekdayProfileOf(
	cleanDays: readonly DailyNetPoint[],
	levelFrom: IsoDate,
): WeekdayProfileEntry[] {
	const level = averageOf(cleanDays.filter((point) => point.date >= levelFrom));
	const overall = averageOf(cleanDays);
	return ISO_WEEKDAYS.map((weekday) => {
		const mean = averageOf(
			cleanDays.filter((point) => isoWeekday(point.date) === weekday),
		);
		return {
			weekday,
			level,
			index: mean === null ? null : mean.divOrNull(overall),
		};
	});
}

export function weekdayProfile(
	store: AggregateStore,
	storeIds: readonly string[],
	origin: IsoDate,
	holidays: readonly HolidayEntry[],
): WeekdayProfileEntry[] {
	const cleanDays = dailyNetSeries(
		store,
		storeIds,
		addDays(origin, 1 - PROFILE_HISTORY_DAYS),
		origin,
		holidays,
	).filter((point) => !point.excluded);
	return weekdayProfileOf(cleanDays, addDays(origin, 1 - PROFILE_LEVEL_DAYS));
}

export function profileForecast(
	entry: WeekdayProfileEntry | undefined,
): PgDecimal | null {
	if (entry === undefined || entry.level === null) return null;
	return entry.level
		.mul(entry.index ?? PgDecimal.integer(1))
		.round(FORECAST_DIGITS);
}

export function profileEntryFor(
	profile: readonly WeekdayProfileEntry[],
	date: IsoDate,
): WeekdayProfileEntry | undefined {
	const weekday = isoWeekday(date);
	return profile.find((entry) => entry.weekday === weekday);
}

export function seasonalNaiveOf(
	series: readonly DailyNetPoint[],
	targetDate: IsoDate,
	origin: IsoDate,
): PgDecimal | null {
	const windowStart = addDays(origin, 1 - SEASONAL_NAIVE_DAYS);
	for (let index = series.length - 1; index >= 0; index -= 1) {
		const point = series[index];
		if (point === undefined || point.date > origin) continue;
		if (point.date < windowStart) break;
		if (daysBetween(point.date, targetDate) % DAYS_PER_WEEK === 0) {
			return point.net.round(FORECAST_DIGITS);
		}
	}
	return null;
}

export function seasonalNaiveSeries(
	store: AggregateStore,
	storeIds: readonly string[],
	origin: IsoDate,
	from: IsoDate,
	to: IsoDate,
	holidays: readonly HolidayEntry[],
): SeasonalNaivePoint[] {
	if (from > to) return [];
	const series = dailyNetSeries(
		store,
		storeIds,
		addDays(minDate(origin, addDays(from, -1)), 1 - SEASONAL_NAIVE_DAYS),
		minDate(origin, addDays(to, -1)),
		holidays,
	);
	return datesBetween(from, to).map((targetDate) => ({
		targetDate,
		forecast: seasonalNaiveOf(
			series,
			targetDate,
			minDate(origin, addDays(targetDate, -1)),
		),
	}));
}
