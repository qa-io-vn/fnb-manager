import type { AnalyticsRow } from "../../contract/functions.js";
import type { IsoDate } from "../../contract/values.js";
import { sumMoney, sumMoneyOrNull } from "../../model/money.js";
import {
	ratio,
	relativeChange,
	roundHalfAwayFromZero,
} from "../../model/numeric.js";
import {
	addDays,
	addMonths,
	addYears,
	daysBetween,
	daysInMonth,
	firstOfMonth,
	lastOfMonth,
	minDate,
	monthOf,
	yearOf,
} from "../../period/dates.js";
import { isoWeeksInYear } from "../../period/iso-week.js";
import type { ReportPeriod } from "../../period/periods.js";

export type SeriesRow = AnalyticsRow<"period_series">;
export type LifecycleRow = AnalyticsRow<"item_lifecycle">;

export const PEAK_COMPLETE_MONTHS_ONLY = true;
export const SEASONALITY_MONTHS = 12;
export const QUIET_DAYS = 56;
export const LIFECYCLE_CHANGE = 0.2;
export const MIN_LIFECYCLE_QUANTITY = 10;
export const YOUNG_STORE_DAYS = 364;
export const SINCE_OPENING_BLOCK_DAYS = 7;
export const TET_DIP_WEEKS_BEFORE = 4;
export const TREND_MONTHS = 3;
export const SEASONALITY_INDEX_DIGITS = 3;
export const MONEY_DIGITS = 2;
export const MATRIX_YEARS = 3;
export const DAYS_PER_WEEK = 7;

const QUANTITY_UNITS = 1000;
const FACTOR_UNITS = 1000;

export interface YearBounds {
	readonly year: number;
	readonly yearStart: IsoDate;
	readonly yearEnd: IsoDate;
	readonly lastYearStart: IsoDate;
	readonly firstYearStart: IsoDate;
	readonly asOf: IsoDate;
}

export function yearBounds(
	period: Pick<ReportPeriod, "from" | "end" | "asOf">,
): YearBounds {
	return {
		year: yearOf(period.from),
		yearStart: period.from,
		yearEnd: period.end,
		lastYearStart: addYears(period.from, -1),
		firstYearStart: addYears(period.from, 1 - MATRIX_YEARS),
		asOf: period.asOf,
	};
}

export function monthStartOf(year: number, month: number): IsoDate {
	return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
}

export function monthKeyOf(date: IsoDate): string {
	return date.slice(0, 7);
}

export function isCompleteMonth(monthStart: IsoDate, asOf: IsoDate): boolean {
	return lastOfMonth(monthStart) <= asOf;
}

export function latestCompleteMonth(yearEnd: IsoDate, asOf: IsoDate): IsoDate {
	const end = minDate(yearEnd, asOf);
	return lastOfMonth(end) === end
		? firstOfMonth(end)
		: addMonths(firstOfMonth(end), -1);
}

export function hasData(row: SeriesRow | undefined): row is SeriesRow {
	return row !== undefined && row.days_with_data > 0;
}

export class SeriesIndex {
	private readonly byKey = new Map<string, SeriesRow>();
	private readonly allRows: SeriesRow[] = [];

	constructor(rows: readonly SeriesRow[]) {
		for (const row of rows) {
			this.byKey.set(SeriesIndex.key(row.store_id, row.bucket_start), row);
			if (row.store_id === null) this.allRows.push(row);
		}
		this.allRows.sort((left, right) =>
			left.bucket_start < right.bucket_start
				? -1
				: left.bucket_start > right.bucket_start
					? 1
					: 0,
		);
	}

	private static key(storeId: string | null, bucketStart: IsoDate): string {
		return `${storeId ?? ""}|${bucketStart}`;
	}

	all(bucketStart: IsoDate): SeriesRow | undefined {
		return this.byKey.get(SeriesIndex.key(null, bucketStart));
	}

	store(storeId: string, bucketStart: IsoDate): SeriesRow | undefined {
		return this.byKey.get(SeriesIndex.key(storeId, bucketStart));
	}

	allStores(): readonly SeriesRow[] {
		return this.allRows;
	}

	monthsOfYear(year: number): SeriesRow[] {
		const prefix = `${String(year).padStart(4, "0")}-`;
		return this.allRows.filter((row) => row.bucket_start.startsWith(prefix));
	}
}

export interface PeakMonth {
	readonly month: IsoDate;
	readonly net: number;
	readonly partial: boolean;
}

export function peakMonth(
	months: SeriesIndex,
	year: number,
	asOf: IsoDate,
	completeOnly: boolean = PEAK_COMPLETE_MONTHS_ONLY,
): PeakMonth | null {
	const withData = months
		.monthsOfYear(year)
		.filter(
			(row): row is SeriesRow & { net_amount: number } =>
				hasData(row) && row.net_amount !== null,
		);
	const candidates = completeOnly
		? withData.filter((row) => isCompleteMonth(row.bucket_start, asOf))
		: withData;
	if (candidates.length === 0) {
		const latest = withData.at(-1);
		if (latest === undefined) return null;
		return {
			month: latest.bucket_start,
			net: latest.net_amount,
			partial: !isCompleteMonth(latest.bucket_start, asOf),
		};
	}
	let best = candidates[0] as SeriesRow & { net_amount: number };
	for (const row of candidates) {
		if (row.net_amount > best.net_amount) best = row;
	}
	return {
		month: best.bucket_start,
		net: best.net_amount,
		partial: !isCompleteMonth(best.bucket_start, asOf),
	};
}

export function coveredSeries(
	months: SeriesIndex,
	storeIds: readonly string[],
): SeriesIndex {
	return new SeriesIndex(
		months.allStores().map((row) => {
			const rows = storeIds
				.map((id) => months.store(id, row.bucket_start))
				.filter(hasData);
			return {
				...row,
				days_with_data: rows.reduce(
					(total, entry) => total + entry.days_with_data,
					0,
				),
				net_amount: sumMoneyOrNull(rows.map((entry) => entry.net_amount)),
			};
		}),
	);
}

export type GrowthBasis = "all_stores" | "like_for_like" | "none";

export interface MonthGrowth {
	readonly month: IsoDate;
	readonly net: number | null;
	readonly lastYearNet: number | null;
	readonly coveredStoreIds: readonly string[];
	readonly coveredNet: number | null;
	readonly coveredLastYearNet: number | null;
	readonly yoy: number | null;
	readonly basis: GrowthBasis;
}

export type HistoryStartOf = (storeId: string) => IsoDate | null;

export function coveredAt(
	storeIds: readonly string[],
	historyStart: HistoryStartOf,
	from: IsoDate,
): string[] {
	return storeIds.filter((id) => {
		const start = historyStart(id);
		return start !== null && start <= from;
	});
}

export function basisOf(covered: number, total: number): GrowthBasis {
	if (covered === 0) return "none";
	return covered === total ? "all_stores" : "like_for_like";
}

function storeNet(
	months: SeriesIndex,
	storeIds: readonly string[],
	month: IsoDate,
): number | null {
	return sumMoneyOrNull(
		storeIds.map((id) => {
			const row = months.store(id, month);
			return hasData(row) ? row.net_amount : null;
		}),
	);
}

function allNet(months: SeriesIndex, month: IsoDate): number | null {
	const row = months.all(month);
	return hasData(row) ? row.net_amount : null;
}

export function monthGrowth(
	months: SeriesIndex,
	month: IsoDate,
	storeIds: readonly string[],
	historyStart: HistoryStartOf,
): MonthGrowth {
	const lastYearMonth = addYears(month, -1);
	const covered = coveredAt(storeIds, historyStart, lastYearMonth);
	const coveredNet = storeNet(months, covered, month);
	const coveredLastYearNet = storeNet(months, covered, lastYearMonth);
	return {
		month,
		net: allNet(months, month),
		lastYearNet: allNet(months, lastYearMonth),
		coveredStoreIds: covered,
		coveredNet,
		coveredLastYearNet,
		yoy:
			covered.length === 0
				? null
				: relativeChange(coveredNet, coveredLastYearNet),
		basis: basisOf(covered.length, storeIds.length),
	};
}

export function monthOnMonth(
	months: SeriesIndex,
	month: IsoDate,
): number | null {
	return relativeChange(
		allNet(months, month),
		allNet(months, addMonths(month, -1)),
	);
}

function windowNet(
	months: SeriesIndex,
	last: IsoDate,
	count: number,
): number | null {
	const values: number[] = [];
	for (let offset = 0; offset < count; offset += 1) {
		const net = allNet(months, addMonths(last, -offset));
		if (net === null) return null;
		values.push(net);
	}
	return sumMoney(values);
}

export function threeMonthChange(
	months: SeriesIndex,
	latestMonth: IsoDate,
): number | null {
	return relativeChange(
		windowNet(months, latestMonth, TREND_MONTHS),
		windowNet(months, addMonths(latestMonth, -TREND_MONTHS), TREND_MONTHS),
	);
}

export function completeMonthsOfYear(
	year: number,
	asOf: IsoDate,
	yearEnd: IsoDate,
): IsoDate[] {
	const months: IsoDate[] = [];
	for (let month = 1; month <= 12; month += 1) {
		const start = monthStartOf(year, month);
		if (start > yearEnd) break;
		if (isCompleteMonth(start, minDate(asOf, yearEnd))) months.push(start);
	}
	return months;
}

export interface SeasonalityMonth {
	readonly month: IsoDate;
	readonly net: number | null;
	readonly calendarDays: number;
	readonly avgDailyNet: number | null;
	readonly index: number | null;
}

export interface Seasonality {
	readonly windowStart: IsoDate;
	readonly windowEnd: IsoDate;
	readonly coveredStoreIds: readonly string[];
	readonly basis: GrowthBasis;
	readonly months: readonly SeasonalityMonth[];
	readonly complete: boolean;
}

export function seasonality(
	months: SeriesIndex,
	latestComplete: IsoDate,
	storeIds: readonly string[],
	historyStart: HistoryStartOf,
): Seasonality {
	const windowStart = addMonths(latestComplete, 1 - SEASONALITY_MONTHS);
	const covered = coveredAt(storeIds, historyStart, windowStart);
	const raw = Array.from({ length: SEASONALITY_MONTHS }, (_, offset) => {
		const month = addMonths(windowStart, offset);
		const calendarDays =
			months.all(month)?.calendar_days ??
			daysInMonth(yearOf(month), monthOf(month));
		const net = covered.length === 0 ? null : storeNet(months, covered, month);
		return {
			month,
			net,
			calendarDays,
			average: net === null ? null : net / calendarDays,
		};
	});
	const complete =
		covered.length > 0 && raw.every((entry) => entry.average !== null);
	const mean = complete
		? raw.reduce((total, entry) => total + (entry.average ?? 0), 0) / raw.length
		: null;
	return {
		windowStart,
		windowEnd: latestComplete,
		coveredStoreIds: covered,
		basis: basisOf(covered.length, storeIds.length),
		months: raw.map((entry) => ({
			month: entry.month,
			net: entry.net,
			calendarDays: entry.calendarDays,
			avgDailyNet:
				entry.net === null
					? null
					: ratio(entry.net, entry.calendarDays, MONEY_DIGITS),
			index:
				mean === null || mean === 0 || entry.average === null
					? null
					: roundHalfAwayFromZero(
							entry.average / mean,
							SEASONALITY_INDEX_DIGITS,
						),
		})),
		complete,
	};
}

export function extremeIndex(
	months: readonly SeasonalityMonth[],
	direction: "highest" | "lowest",
): SeasonalityMonth | null {
	let found: (SeasonalityMonth & { index: number }) | null = null;
	for (const entry of months) {
		if (entry.index === null) continue;
		const better =
			found === null ||
			(direction === "highest"
				? entry.index > found.index
				: entry.index < found.index);
		if (better) found = { ...entry, index: entry.index };
	}
	return found;
}

export function tetMonth(months: SeriesIndex, year: number): IsoDate | null {
	let found: SeriesRow | null = null;
	for (const row of months.monthsOfYear(year)) {
		if (row.tet_days <= 0) continue;
		if (found === null || row.tet_days > found.tet_days) found = row;
	}
	return found?.bucket_start ?? null;
}

export interface TetDip {
	readonly isoYear: number;
	readonly week: SeriesRow;
	readonly dip: number;
}

function averagePerDay(row: SeriesRow): number | null {
	if (!hasData(row) || row.net_amount === null || row.calendar_days <= 0) {
		return null;
	}
	return row.net_amount / row.calendar_days;
}

export function tetDip(
	weeks: readonly SeriesRow[],
	isoYear: number,
): TetDip | null {
	let tetIndex = -1;
	weeks.forEach((row, index) => {
		if (row.iso_year !== isoYear || row.tet_days <= 0) return;
		const best = weeks[tetIndex];
		if (best === undefined || row.tet_days > best.tet_days) tetIndex = index;
	});
	const week = weeks[tetIndex];
	if (week === undefined || tetIndex < TET_DIP_WEEKS_BEFORE) return null;
	const current = averagePerDay(week);
	const before = weeks
		.slice(tetIndex - TET_DIP_WEEKS_BEFORE, tetIndex)
		.map(averagePerDay);
	if (current === null || before.some((value) => value === null)) {
		return null;
	}
	const mean =
		before.reduce<number>((total, value) => total + (value ?? 0), 0) /
		before.length;
	const dip = relativeChange(current, mean);
	return dip === null ? null : { isoYear, week, dip };
}

export function isoWeekCount(isoYears: readonly number[]): number {
	return Math.max(...isoYears.map((isoYear) => isoWeeksInYear(isoYear)));
}

export function weeklyNet(
	weeks: readonly SeriesRow[],
	isoYear: number,
	weekCount: number,
): (number | null)[] {
	const byWeek = new Map<number, SeriesRow>();
	for (const row of weeks) {
		if (row.iso_year === isoYear && row.iso_week !== null) {
			byWeek.set(row.iso_week, row);
		}
	}
	return Array.from({ length: weekCount }, (_, offset) => {
		const row = byWeek.get(offset + 1);
		if (row === undefined || row.calendar_days !== DAYS_PER_WEEK) {
			return null;
		}
		return hasData(row) ? row.net_amount : null;
	});
}

export function tetWeekRange(
	weeks: readonly SeriesRow[],
	isoYear: number,
): { readonly from: number; readonly to: number } | null {
	const tetWeeks = weeks
		.filter(
			(row) =>
				row.iso_year === isoYear && row.iso_week !== null && row.tet_days > 0,
		)
		.map((row) => row.iso_week as number);
	if (tetWeeks.length === 0) return null;
	return { from: Math.min(...tetWeeks), to: Math.max(...tetWeeks) };
}

export type LifecycleStatus =
	| "new"
	| "growing"
	| "declining"
	| "discontinued"
	| "steady";

export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
	"new",
	"growing",
	"declining",
	"discontinued",
	"steady",
];

export const YOUNG_LIFECYCLE_STATUSES: readonly LifecycleStatus[] = [
	"new",
	"discontinued",
];

function thousandths(value: number | null): number {
	return value === null ? 0 : Math.round(value * QUANTITY_UNITS);
}

function factor(change: number): number {
	return Math.round(change * FACTOR_UNITS);
}

export function quietSince(yearEnd: IsoDate): IsoDate {
	return addDays(yearEnd, 1 - QUIET_DAYS);
}

export function lifecycleStatus(
	row: Pick<
		LifecycleRow,
		"first_sold_on" | "last_sold_on" | "quantity_ytd" | "quantity_last_ytd"
	>,
	bounds: Pick<YearBounds, "yearStart" | "yearEnd" | "lastYearStart">,
	limited = false,
): LifecycleStatus | null {
	const first = row.first_sold_on;
	const last = row.last_sold_on;
	if (first === null || last === null || last < bounds.lastYearStart) {
		return null;
	}
	if (first >= bounds.yearStart) return "new";
	if (last < quietSince(bounds.yearEnd)) return "discontinued";
	if (limited) return null;
	const current = thousandths(row.quantity_ytd);
	const reference = thousandths(row.quantity_last_ytd);
	if (reference >= MIN_LIFECYCLE_QUANTITY * QUANTITY_UNITS) {
		if (
			current * FACTOR_UNITS >=
			reference * (FACTOR_UNITS + factor(LIFECYCLE_CHANGE))
		) {
			return "growing";
		}
		if (
			current * FACTOR_UNITS <=
			reference * (FACTOR_UNITS - factor(LIFECYCLE_CHANGE))
		) {
			return "declining";
		}
	}
	return last >= bounds.yearStart ? "steady" : null;
}

export interface SinceBlock {
	readonly week: number;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly complete: boolean;
	readonly daysWithData: number;
	readonly net: number | null;
	readonly avgPerDay: number | null;
}

export function sinceOpeningBlocks(
	days: readonly SeriesRow[],
	historyStart: IsoDate,
	yearEnd: IsoDate,
): SinceBlock[] {
	if (historyStart > yearEnd) return [];
	const byDate = new Map(days.map((row) => [row.bucket_start, row]));
	const blockCount =
		Math.floor(daysBetween(historyStart, yearEnd) / SINCE_OPENING_BLOCK_DAYS) +
		1;
	return Array.from({ length: blockCount }, (_, offset) => {
		const from = addDays(historyStart, offset * SINCE_OPENING_BLOCK_DAYS);
		const to = addDays(from, SINCE_OPENING_BLOCK_DAYS - 1);
		const nets: number[] = [];
		for (
			let date = from;
			date <= minDate(to, yearEnd);
			date = addDays(date, 1)
		) {
			const row = byDate.get(date);
			if (hasData(row) && row.net_amount !== null) nets.push(row.net_amount);
		}
		const net = nets.length === 0 ? null : sumMoney(nets);
		return {
			week: offset + 1,
			from,
			to,
			complete: to <= yearEnd,
			daysWithData: nets.length,
			net,
			avgPerDay: ratio(net, nets.length, MONEY_DIGITS),
		};
	});
}

export function isYoungForYear(
	historyStart: IsoDate | null,
	yearEnd: IsoDate,
): boolean {
	return (
		historyStart !== null && historyStart > addDays(yearEnd, -YOUNG_STORE_DAYS)
	);
}

export function opensWithinYear(
	historyStart: IsoDate | null,
	yearEnd: IsoDate,
): historyStart is IsoDate {
	return (
		historyStart !== null &&
		historyStart <= yearEnd &&
		isYoungForYear(historyStart, yearEnd)
	);
}
