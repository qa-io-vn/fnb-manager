import type { AnalyticsArgs, AnalyticsRow } from "../../contract/functions.js";
import type { IsoDate } from "../../contract/values.js";
import {
	type CallSpec,
	type CardInput,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	COVERAGE_CALL_KEY,
	call,
	coverageCall,
	likeForLikeCalls,
	METRICS_LIKE_FOR_LIKE_KEYS,
	type ReportContext,
	storeIdsOf,
} from "../../definition.js";
import {
	type CardMarkers,
	type Comparison,
	csvName,
} from "../../model/card.js";
import type { ReferenceKind } from "../../model/comparison.js";
import type { CoverageModel } from "../../model/coverage.js";
import {
	lastYearLabelKey,
	previousLabelKey,
	reportKeys,
} from "../../model/keys.js";
import { roundHalfAwayFromZero } from "../../model/numeric.js";
import {
	markersOf,
	likeForLikeMetrics as sharedLikeForLikeMetrics,
	likeForLikeTotals as sharedLikeForLikeTotals,
	type TotalsRow,
} from "../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../model/values.js";
import { boundOf } from "../../period/bounds.js";
import { addDays, addMonths } from "../../period/dates.js";

export const MONTH_SLUG = "thang";
export const MONTH_BASELINE_WEEKS = 8;
export const FORECAST_ACCURACY_DAYS = 28;
export const STORE_PACE_PREFIX = "pace.";
export const STORE_PACE_NEEDS = `${STORE_PACE_PREFIX}*`;
export const COVERED_PACE_PREFIX = "paceCovered.";
export const COVERED_PACE_NEEDS = `${COVERED_PACE_PREFIX}*`;

export const MONTH_METRIC_IDS = [
	"size_l_share",
	"attach_rate_topping",
	"attach_rate_snack",
	"discount_rate",
	"voucher_invoice_share",
	"gross_revenue",
	"cash_share",
] as const;

export const monthCalls = {
	coverage: COVERAGE_CALL_KEY,
	compare: "compare",
	pace: "pace",
	accuracy: "accuracy",
	days: "days",
	months: "months",
	baselines: "baselines",
	items: "items",
	metrics: "metrics",
	payments: "payments",
	promotions: "promotions",
	shifts: "shifts",
	shiftsPrevious: "shiftsPrevious",
	targets: "targets",
	itemsCovered: "itemsCovered",
} as const;

const compareFollowUps = [
	COMPARE_LIKE_FOR_LIKE_KEYS.previous,
	COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
] as const;
const metricFollowUps = [
	METRICS_LIKE_FOR_LIKE_KEYS.previous,
	METRICS_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const monthNeeds = {
	pace: [
		monthCalls.coverage,
		monthCalls.compare,
		monthCalls.pace,
		monthCalls.accuracy,
		monthCalls.days,
		monthCalls.months,
		monthCalls.targets,
		COVERED_PACE_NEEDS,
		...compareFollowUps,
	],
	days: [monthCalls.coverage, monthCalls.days, monthCalls.baselines],
	pareto: [monthCalls.coverage, monthCalls.items, monthCalls.itemsCovered],
	size: [
		monthCalls.coverage,
		monthCalls.metrics,
		monthCalls.items,
		...metricFollowUps,
	],
	attach: [monthCalls.coverage, monthCalls.metrics, ...metricFollowUps],
	newItems: [monthCalls.coverage, monthCalls.items, monthCalls.itemsCovered],
	payments: [
		monthCalls.coverage,
		monthCalls.metrics,
		monthCalls.payments,
		...metricFollowUps,
	],
	discounts: [
		monthCalls.coverage,
		monthCalls.compare,
		monthCalls.metrics,
		monthCalls.promotions,
		...compareFollowUps,
		...metricFollowUps,
	],
	shifts: [monthCalls.coverage, monthCalls.shifts, monthCalls.shiftsPrevious],
	target: [
		monthCalls.coverage,
		monthCalls.pace,
		monthCalls.accuracy,
		monthCalls.targets,
		STORE_PACE_NEEDS,
	],
} as const;

export interface MonthRanges {
	readonly monthStart: IsoDate;
	readonly end: IsoDate;
	readonly monthEnd: IsoDate;
	readonly previousStart: IsoDate;
	readonly previousEnd: IsoDate;
	readonly previousMonthEnd: IsoDate;
	readonly lastYearStart: IsoDate;
	readonly lastYearEnd: IsoDate;
}

export function monthRanges(
	context: Pick<ReportContext, "period">,
): MonthRanges {
	const { period } = context;
	const previous = boundOf("month", period.end, "previous");
	const lastYear = boundOf("month", period.end, "last_year");
	const previousStart = previous?.from ?? addMonths(period.from, -1);
	return {
		monthStart: period.from,
		end: period.end,
		monthEnd: period.to,
		previousStart,
		previousEnd: previous?.to ?? addDays(period.from, -1),
		previousMonthEnd: addDays(period.from, -1),
		lastYearStart: lastYear?.from ?? addMonths(period.from, -12),
		lastYearEnd: lastYear?.to ?? addMonths(period.end, -12),
	};
}

export function storePaceKey(storeId: string): string {
	return `${STORE_PACE_PREFIX}${storeId}`;
}

export function coveredPaceKey(storeId: string): string {
	return `${COVERED_PACE_PREFIX}${storeId}`;
}

function paceArgs(
	storeIds: readonly string[],
	ranges: MonthRanges,
): AnalyticsArgs<"month_pace"> {
	return {
		store_ids: [...storeIds],
		month_start: ranges.monthStart,
		as_of: ranges.end,
	};
}

export function monthPrimaryCalls(context: ReportContext): readonly CallSpec[] {
	const storeIds = storeIdsOf(context);
	const ranges = monthRanges(context);
	const month = {
		store_ids: storeIds,
		from_date: ranges.monthStart,
		to_date: ranges.end,
	};
	const withPrevious = {
		...month,
		compare_from: ranges.previousStart,
		compare_to: ranges.previousEnd,
	};
	const pace = (ids: readonly string[]) => paceArgs(ids, ranges);
	return [
		coverageCall(context),
		call(monthCalls.compare, "period_compare_by_store", {
			store_ids: storeIds,
			grain: "month",
			anchor: ranges.end,
		}),
		call(monthCalls.pace, "month_pace", pace(storeIds)),
		call(monthCalls.accuracy, "forecast_accuracy", {
			store_ids: storeIds,
			as_of_date: ranges.end,
			days: FORECAST_ACCURACY_DAYS,
		}),
		call(monthCalls.days, "period_series", { ...month, grain: "day" }),
		call(monthCalls.months, "period_series", {
			store_ids: storeIds,
			grain: "month",
			from_date: ranges.previousStart,
			to_date: ranges.end,
		}),
		call(monthCalls.baselines, "daily_baselines", {
			...month,
			weeks: MONTH_BASELINE_WEEKS,
		}),
		call(monthCalls.items, "item_summary", withPrevious),
		call(monthCalls.metrics, "metric_compare", {
			store_ids: storeIds,
			metric_ids: [...MONTH_METRIC_IDS],
			grain: "month",
			anchor: ranges.end,
		}),
		call(monthCalls.payments, "payment_summary", withPrevious),
		call(monthCalls.promotions, "promotion_summary", month),
		call(monthCalls.shifts, "shift_review", month),
		call(monthCalls.shiftsPrevious, "shift_review", {
			store_ids: storeIds,
			from_date: ranges.previousStart,
			to_date: ranges.previousEnd,
		}),
		call(monthCalls.targets, "store_targets", {
			store_ids: storeIds,
			period_kind: "month",
			period_start: ranges.monthStart,
		}),
		...(storeIds.length >= 2
			? storeIds.map((id) => call(storePaceKey(id), "month_pace", pace([id])))
			: []),
	];
}

export function monthFollowUpCalls(
	context: ReportContext,
	coverage: CoverageModel,
): readonly CallSpec[] {
	const ranges = monthRanges(context);
	const previous = coverage.forReference(ranges.previousStart);
	return [
		...likeForLikeCalls(context, coverage, {
			grain: "month",
			metricIds: MONTH_METRIC_IDS,
		}),
		...(previous.state === "partial"
			? previous.coveredStoreIds.map((id) =>
					call(coveredPaceKey(id), "month_pace", paceArgs([id], ranges)),
				)
			: []),
		...(previous.state === "partial"
			? [
					call(monthCalls.itemsCovered, "item_summary", {
						store_ids: [...previous.coveredStoreIds],
						from_date: ranges.monthStart,
						to_date: ranges.end,
						compare_from: ranges.previousStart,
						compare_to: ranges.previousEnd,
					}),
				]
			: []),
	];
}

export type PaceRow = AnalyticsRow<"month_pace">;
export type AccuracyRow = AnalyticsRow<"forecast_accuracy">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type ItemRow = AnalyticsRow<"item_summary">;
export type MetricRow = AnalyticsRow<"metric_compare">;

export function compareRows(input: CardInput): readonly TotalsRow[] {
	return (
		input.results.rows(monthCalls.compare, "period_compare_by_store") ?? []
	);
}

export function paceRow(input: CardInput): PaceRow | null {
	return input.results.rows(monthCalls.pace, "month_pace")?.[0] ?? null;
}

export function coveredPaceRow(
	input: CardInput,
	storeId: string,
): PaceRow | null {
	return input.results.rows(coveredPaceKey(storeId), "month_pace")?.[0] ?? null;
}

export function storePaceRow(
	input: CardInput,
	storeId: string,
): PaceRow | null {
	if (input.context.stores.length < 2) {
		return input.context.stores[0]?.id === storeId ? paceRow(input) : null;
	}
	return input.results.rows(storePaceKey(storeId), "month_pace")?.[0] ?? null;
}

export function accuracyRows(input: CardInput): readonly AccuracyRow[] {
	return input.results.rows(monthCalls.accuracy, "forecast_accuracy") ?? [];
}

export function seriesRows(
	input: CardInput,
	key: typeof monthCalls.days | typeof monthCalls.months,
): readonly SeriesRow[] {
	return input.results.rows(key, "period_series") ?? [];
}

export function itemRows(input: CardInput): readonly ItemRow[] {
	return input.results.rows(monthCalls.items, "item_summary") ?? [];
}

export function metricRows(input: CardInput): readonly MetricRow[] {
	return input.results.rows(monthCalls.metrics, "metric_compare") ?? [];
}

export function metricValueOf(
	rows: readonly MetricRow[],
	metricId: string,
	period: MetricRow["period"],
): number | null {
	return (
		rows.find((row) => row.metric_id === metricId && row.period === period)
			?.value ?? null
	);
}

export function likeForLikeTotals(
	input: CardInput,
): Partial<Record<ReferenceKind, readonly AnalyticsRow<"period_compare">[]>> {
	return sharedLikeForLikeTotals(input.results);
}

export function likeForLikeMetrics(
	input: CardInput,
): Partial<Record<ReferenceKind, readonly AnalyticsRow<"metric_compare">[]>> {
	return sharedLikeForLikeMetrics(input.results);
}

export function monthLabels(): Readonly<
	Record<"previous" | "last_year" | "baseline", SentencePart>
> {
	return {
		previous: part(previousLabelKey("month")),
		last_year: part(lastYearLabelKey("month")),
		baseline: part(reportKeys.compare.baseline),
	};
}

export function monthValue(context: Pick<ReportContext, "period">): TypedValue {
	return textValue("month", context.period.from);
}

export function monthMarkers(
	input: CardInput,
	readsAggregates: boolean,
): CardMarkers {
	return markersOf(input.coverage, readsAggregates);
}

export function monthCsvName(context: ReportContext, cardId: string): string {
	return csvName(MONTH_SLUG, cardId.replace(/_/g, "-"), context.period.key);
}

export function storeName(
	context: ReportContext,
	storeId: string | null,
): string {
	return context.stores.find((store) => store.id === storeId)?.name ?? "";
}

const POINTS_PER_FRACTION = 100;
const POINT_DIGITS = 1;

export function pointsValue(comparison: Comparison | null): TypedValue | null {
	if (
		comparison === null ||
		comparison.unavailable !== null ||
		comparison.difference === null
	) {
		return null;
	}
	return numberValue(
		"pointMagnitude",
		roundHalfAwayFromZero(
			Math.abs(comparison.difference) * POINTS_PER_FRACTION,
			POINT_DIGITS,
		),
	);
}

export {
	changeCell,
	comparisonOf,
	isMultiStore,
	pickFrom,
	type TotalsRow,
	totalsOf,
} from "../../model/totals.js";
