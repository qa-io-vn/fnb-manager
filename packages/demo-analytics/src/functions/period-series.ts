import {
	type AnalyticsRow,
	datesBetween,
	firstOfMonth,
	firstOfYear,
	type IsoDate,
	isoWeekday,
	isoWeekOf,
	maxDate,
	mondayOf,
	type SeriesGrain,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoStoreDefinition } from "../calendar.js";
import {
	holidayKindOn,
	isExcludedDemoDay,
	isTetWindowDay,
} from "../excluded.js";
import {
	dailySales,
	type HandlerArgs,
	type HandlerContext,
	requireDateRange,
	requireReportRows,
	requireStoreIds,
	sumDaily,
	totalsOf,
} from "./support.js";

type Row = AnalyticsRow<"period_series">;

export const PERIOD_SERIES_MAX_DAYS = 1100;

interface Bucket {
	readonly start: IsoDate;
	readonly end: IsoDate;
	readonly weekday: number | null;
	readonly dates: readonly IsoDate[];
}

function groupStart(grain: SeriesGrain, date: IsoDate, from: IsoDate): IsoDate {
	switch (grain) {
		case "day":
			return date;
		case "week":
			return maxDate(mondayOf(date), from);
		case "month":
			return maxDate(firstOfMonth(date), from);
		case "year":
			return maxDate(firstOfYear(date), from);
		case "weekday":
			return from;
	}
}

export function seriesBuckets(
	grain: SeriesGrain,
	from: IsoDate,
	to: IsoDate,
): Bucket[] {
	const dates = datesBetween(from, to);
	if (grain === "weekday") {
		return [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
			start: from,
			end: to,
			weekday,
			dates: dates.filter((date) => isoWeekday(date) === weekday),
		}));
	}
	const buckets: Bucket[] = [];
	let current: { start: IsoDate; dates: IsoDate[] } | null = null;
	for (const date of dates) {
		const start = groupStart(grain, date, from);
		if (current === null || current.start !== start) {
			current = { start, dates: [] };
			buckets.push({
				start,
				end: start,
				weekday: grain === "day" ? isoWeekday(date) : null,
				dates: current.dates,
			});
		}
		current.dates.push(date);
	}
	return buckets.map((bucket) => ({
		...bucket,
		end: bucket.dates[bucket.dates.length - 1] ?? bucket.start,
	}));
}

function checkCounts(
	store: AggregateStore,
	stores: readonly DemoStoreDefinition[],
	dates: readonly IsoDate[],
): { checked: number; matched: number } {
	let checked = 0;
	let matched = 0;
	for (const visible of stores) {
		for (const date of dates) {
			const check = store.days.syncCheck(visible, date);
			if (check === null) continue;
			checked += 1;
			if (check.matched) matched += 1;
		}
	}
	return { checked, matched };
}

export function periodSeries(
	store: AggregateStore,
	args: HandlerArgs<"period_series">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("period_series", args.store_ids);
	requireDateRange(
		"period_series",
		args.from_date,
		args.to_date,
		PERIOD_SERIES_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	const includeStores = args.include_stores ?? true;
	const buckets = seriesBuckets(args.grain, args.from_date, args.to_date);
	requireReportRows(
		"period_series",
		buckets.length * (includeStores ? visible.length + 1 : 1),
	);
	const daily = dailySales(store, args.store_ids, args.from_date, args.to_date);
	const dailyByKey = new Map(
		daily.map((row) => [`${row.store.id}|${row.date}`, row]),
	);
	const withHolidays = visible.length > 0;
	const blocks: { storeId: string | null; stores: DemoStoreDefinition[] }[] = [
		{ storeId: null, stores: visible },
		...(includeStores
			? visible.map((item) => ({ storeId: item.id, stores: [item] }))
			: []),
	];
	const rows: Row[] = [];
	for (const bucket of buckets) {
		const excludedDays = withHolidays
			? bucket.dates.filter((date) => isExcludedDemoDay(context.holidays, date))
					.length
			: 0;
		const tetDays = withHolidays
			? bucket.dates.filter((date) => isTetWindowDay(context.holidays, date))
					.length
			: 0;
		const holidayKind =
			args.grain === "day" && withHolidays && bucket.dates[0] !== undefined
				? holidayKindOn(context.holidays, bucket.dates[0])
				: null;
		const week =
			args.grain === "day" || args.grain === "week"
				? isoWeekOf(bucket.start)
				: null;
		for (const block of blocks) {
			const blockRows = block.stores.flatMap((item) =>
				bucket.dates.flatMap((date) => {
					const row = dailyByKey.get(`${item.id}|${date}`);
					return row === undefined ? [] : [row];
				}),
			);
			const checks = checkCounts(store, block.stores, bucket.dates);
			rows.push({
				store_id: block.storeId,
				bucket_start: bucket.start,
				bucket_end: bucket.end,
				iso_year: week?.isoYear ?? null,
				iso_week: week?.isoWeek ?? null,
				weekday: bucket.weekday,
				calendar_days: bucket.dates.length,
				excluded_days: excludedDays,
				tet_days: tetDays,
				holiday_kind: holidayKind,
				checked_days: checks.checked,
				matched_days: checks.matched,
				...totalsOf(sumDaily(blockRows)),
			});
		}
	}
	return rows;
}
