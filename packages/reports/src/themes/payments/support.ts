import type { AnalyticsRow } from "../../contract/functions.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { CoverageModel } from "../../model/coverage.js";
import type { ThemeContext } from "../context.js";
import {
	likeForLikeRangeCalls,
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

export const PAYMENTS_SLUG = "thanh-toan";
export const DAY_BUCKET_MAX_DAYS = 35;

export const paymentsCalls = {
	coverage: COVERAGE_CALL_KEY,
	totals: TOTALS_CALL_KEY,
	payments: "payments",
	paymentsPrevious: "paymentsPrevious",
	series: "series",
	settings: "settings",
} as const;

export const paymentsNeeds = {
	mix: [
		paymentsCalls.coverage,
		paymentsCalls.totals,
		TOTALS_LIKE_FOR_LIKE_KEYS.previous,
		TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
		paymentsCalls.payments,
	],
	trend: [paymentsCalls.coverage, paymentsCalls.series],
} as const;

export type PaymentRow = AnalyticsRow<"payment_summary">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type BucketGrain = "day" | "week";

export function bucketGrain(days: number): BucketGrain {
	return days <= DAY_BUCKET_MAX_DAYS ? "day" : "week";
}

export function paymentsPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	return [
		themeCoverageCall(context),
		totalsCall(context),
		reportCall(paymentsCalls.payments, "payment_summary", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
			compare_from: range.previous.from,
			compare_to: range.previous.to,
		}),
		reportCall(paymentsCalls.paymentsPrevious, "payment_summary", {
			store_ids: storeIds,
			from_date: range.previous.from,
			to_date: range.previous.to,
		}),
		reportCall(paymentsCalls.series, "period_series", {
			store_ids: storeIds,
			grain: bucketGrain(range.days),
			from_date: range.from,
			to_date: range.to,
			include_stores: false,
		}),
		reportCall(paymentsCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
	];
}

export function paymentsFollowUpCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	return likeForLikeRangeCalls(context, coverage);
}

export function totalsRows(
	results: ThemeCallResults,
	key: string = paymentsCalls.totals,
): readonly RangeTotalsRow[] {
	return results.rows(key, "range_totals") ?? [];
}

export function seriesRows(results: ThemeCallResults): readonly SeriesRow[] {
	return [...(results.rows(paymentsCalls.series, "period_series") ?? [])]
		.filter((row) => row.store_id === null)
		.sort((left, right) => (left.bucket_start < right.bucket_start ? -1 : 1));
}

export function paymentsCsvName(context: ThemeContext, card: string): string {
	return csvName(PAYMENTS_SLUG, card, context.range.key);
}
