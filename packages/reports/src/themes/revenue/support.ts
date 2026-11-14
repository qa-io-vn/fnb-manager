import type { AnalyticsRow } from "../../contract/functions.js";
import type { DateRange, IsoDate } from "../../contract/values.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { CoverageModel } from "../../model/coverage.js";
import type { TotalsRow } from "../../model/totals.js";
import { addDays, addYears } from "../../period/dates.js";
import { mondayOf } from "../../period/iso-week.js";
import type { ThemeContext } from "../context.js";
import {
	likeForLikeRangeCalls,
	RANGE_INDEX,
	type RangeTotalsRow,
	type ReportCallSpec,
	reportCall,
	type ThemeCallResults,
	TOTALS_CALL_KEY,
	TOTALS_LIKE_FOR_LIKE_KEYS,
	themeCoverageCall,
	themeStoreIds,
	totalsCall,
} from "../definition.js";

export const REVENUE_SLUG = "doanh-thu";
export const MONTHS_MIN_DAYS = 56;
export const DAY_SERIES_MAX_DAYS = 92;
export const DAY_AVERAGE_POINTS = 7;
export const WEEK_AVERAGE_POINTS = 4;

export const revenueCalls = {
	coverage: COVERAGE_CALL_KEY,
	totals: TOTALS_CALL_KEY,
	series: "series",
	seriesLastYear: "seriesLastYear",
	months: "months",
	monthsLastYear: "monthsLastYear",
} as const;

const likeForLikeKeys = [
	TOTALS_LIKE_FOR_LIKE_KEYS.previous,
	TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const revenueNeeds = {
	totals: [revenueCalls.coverage, revenueCalls.totals, ...likeForLikeKeys],
	trend: [
		revenueCalls.coverage,
		revenueCalls.series,
		revenueCalls.seriesLastYear,
	],
	months: [
		revenueCalls.coverage,
		revenueCalls.months,
		revenueCalls.monthsLastYear,
	],
	stores: [revenueCalls.coverage, revenueCalls.totals],
} as const;

export type TrendGrain = "day" | "week";

export interface TrendPlan {
	readonly grain: TrendGrain;
	readonly points: number;
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export function trendGrain(days: number): TrendGrain {
	return days <= DAY_SERIES_MAX_DAYS ? "day" : "week";
}

export function trendPlan(
	range: DateRange & { days?: number },
	days: number,
): TrendPlan {
	const grain = trendGrain(days);
	if (grain === "day") {
		return {
			grain,
			points: DAY_AVERAGE_POINTS,
			from: addDays(range.from, -(DAY_AVERAGE_POINTS - 1)),
			to: range.to,
		};
	}
	return {
		grain,
		points: WEEK_AVERAGE_POINTS,
		from: addDays(mondayOf(range.from), -7 * (WEEK_AVERAGE_POINTS - 1)),
		to: range.to,
	};
}

function seriesCall(
	key: string,
	context: ThemeContext,
	plan: TrendPlan,
): ReportCallSpec<"period_series"> {
	return reportCall(key, "period_series", {
		store_ids: themeStoreIds(context),
		grain: plan.grain,
		from_date: plan.from,
		to_date: plan.to,
		include_stores: false,
	});
}

export function revenuePrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const { range } = context;
	const calls: ReportCallSpec[] = [
		themeCoverageCall(context),
		totalsCall(context),
	];
	calls.push(
		seriesCall(revenueCalls.series, context, trendPlan(range, range.days)),
	);
	if (range.lastYear !== null) {
		calls.push(
			seriesCall(
				revenueCalls.seriesLastYear,
				context,
				trendPlan(range.lastYear, range.days),
			),
		);
	}
	if (range.days >= MONTHS_MIN_DAYS) {
		const storeIds = themeStoreIds(context);
		calls.push(
			reportCall(revenueCalls.months, "period_series", {
				store_ids: storeIds,
				grain: "month",
				from_date: range.from,
				to_date: range.to,
				include_stores: true,
			}),
			reportCall(revenueCalls.monthsLastYear, "period_series", {
				store_ids: storeIds,
				grain: "month",
				from_date: addYears(range.from, -1),
				to_date: addYears(range.to, -1),
				include_stores: true,
			}),
		);
	}
	return calls;
}

export function revenueFollowUpCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	return likeForLikeRangeCalls(context, coverage);
}

export type SeriesRow = AnalyticsRow<"period_series">;

export function seriesRowsOf(
	results: ThemeCallResults,
	key: string,
): readonly SeriesRow[] {
	return [...(results.rows(key, "period_series") ?? [])].sort((left, right) =>
		left.bucket_start < right.bucket_start ? -1 : 1,
	);
}

export function totalsRowsOf(
	results: ThemeCallResults,
	key: string = revenueCalls.totals,
): readonly RangeTotalsRow[] {
	return results.rows(key, "range_totals") ?? [];
}

const PERIOD_OF_INDEX: Readonly<Record<number, TotalsRow["period"]>> = {
	[RANGE_INDEX.current]: "current",
	[RANGE_INDEX.previous]: "previous",
	[RANGE_INDEX.last_year]: "last_year",
};

export function asPeriodRows(rows: readonly RangeTotalsRow[]): TotalsRow[] {
	return rows.flatMap(({ range_index, ...rest }) => {
		const period = PERIOD_OF_INDEX[range_index];
		return period === undefined ? [] : [{ ...rest, period }];
	});
}

export function revenueCsvName(context: ThemeContext, card: string): string {
	return csvName(REVENUE_SLUG, card, context.range.key);
}
