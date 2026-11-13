import type { AnalyticsRow } from "../../contract/functions.js";
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
import type {
	PeriodReferenceKind,
	ReferenceKind,
} from "../../model/comparison.js";
import type { DecompositionSums } from "../../model/decomposition.js";
import {
	lastYearLabelKey,
	previousLabelKey,
	reportKeys,
} from "../../model/keys.js";
import {
	markersOf,
	type StoreTotals,
	decompositionInputs as sharedDecompositionInputs,
	likeForLikeMetrics as sharedLikeForLikeMetrics,
	likeForLikeTotals as sharedLikeForLikeTotals,
	storeTotals as sharedStoreTotals,
	youngStoreNote as sharedYoungStoreNote,
	youngStoreState as sharedYoungStoreState,
	type TotalsRow,
} from "../../model/totals.js";
import {
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../model/values.js";
import { boundOf } from "../../period/bounds.js";
import { addDays } from "../../period/dates.js";

export const DAY_SLUG = "ngay";
export const DAY_BASELINE_WEEKS = 8;
export const TOP_ITEM_COUNT = 5;
export const ITEM_DRIVER_POOL = 10;

export const DAY_METRIC_IDS = [
	"peak_share_20_21",
	"discount_rate",
	"voucher_invoice_share",
	"customer_capture_rate",
] as const;

export const dayCalls = {
	coverage: COVERAGE_CALL_KEY,
	compare: "compare",
	hourly: "hourly",
	metrics: "metrics",
	items: "items",
	payments: "payments",
	shifts: "shifts",
	promotions: "promotions",
} as const;

const compareFollowUps = [
	COMPARE_LIKE_FOR_LIKE_KEYS.previous,
	COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
] as const;
const metricFollowUps = [
	METRICS_LIKE_FOR_LIKE_KEYS.previous,
	METRICS_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const dayNeeds = {
	totals: [dayCalls.coverage, dayCalls.compare, ...compareFollowUps],
	totalsWithHours: [
		dayCalls.coverage,
		dayCalls.compare,
		dayCalls.hourly,
		...compareFollowUps,
	],
	hourly: [
		dayCalls.coverage,
		dayCalls.hourly,
		dayCalls.metrics,
		...metricFollowUps,
	],
	items: [dayCalls.coverage, dayCalls.items],
	payments: [
		dayCalls.coverage,
		dayCalls.compare,
		dayCalls.payments,
		...compareFollowUps,
	],
	shifts: [dayCalls.coverage, dayCalls.shifts],
	discounts: [
		dayCalls.coverage,
		dayCalls.compare,
		dayCalls.metrics,
		dayCalls.promotions,
		...compareFollowUps,
		...metricFollowUps,
	],
	members: [dayCalls.coverage, dayCalls.compare, ...compareFollowUps],
} as const;

export function dayPrimaryCalls(context: ReportContext): readonly CallSpec[] {
	const storeIds = storeIdsOf(context);
	const day = context.period.end;
	const previous = addDays(day, -1);
	const range = { store_ids: storeIds, from_date: day, to_date: day };
	const withPrevious = {
		...range,
		compare_from: previous,
		compare_to: previous,
	};
	return [
		coverageCall(context),
		call(dayCalls.compare, "period_compare_by_store", {
			store_ids: storeIds,
			grain: "day",
			anchor: day,
		}),
		call(dayCalls.hourly, "hourly_profile", {
			store_ids: storeIds,
			target_date: day,
			weeks: DAY_BASELINE_WEEKS,
		}),
		call(dayCalls.metrics, "metric_compare", {
			store_ids: storeIds,
			metric_ids: [...DAY_METRIC_IDS],
			grain: "day",
			anchor: day,
		}),
		call(dayCalls.items, "item_summary", withPrevious),
		call(dayCalls.payments, "payment_summary", withPrevious),
		call(dayCalls.shifts, "shift_review", range),
		call(dayCalls.promotions, "promotion_summary", range),
	];
}

export function dayFollowUpCalls(
	context: ReportContext,
	coverage: Parameters<typeof likeForLikeCalls>[1],
): readonly CallSpec[] {
	return likeForLikeCalls(context, coverage, {
		grain: "day",
		metricIds: DAY_METRIC_IDS,
	});
}

export type { TotalsRow } from "../../model/totals.js";
export type HourRow = AnalyticsRow<"hourly_profile">;

export function compareRows(input: CardInput): readonly TotalsRow[] {
	return input.results.rows(dayCalls.compare, "period_compare_by_store") ?? [];
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

export function metricRows(
	input: CardInput,
): readonly AnalyticsRow<"metric_compare">[] {
	return input.results.rows(dayCalls.metrics, "metric_compare") ?? [];
}

export function hourRows(input: CardInput): readonly HourRow[] {
	return input.results.rows(dayCalls.hourly, "hourly_profile") ?? [];
}

export function dayLabels(): Readonly<
	Record<PeriodReferenceKind, SentencePart>
> {
	return {
		previous: part(previousLabelKey("day")),
		last_year: part(lastYearLabelKey("day")),
		baseline: part(reportKeys.compare.baseline),
	};
}

export function dayValue(context: ReportContext): TypedValue {
	return textValue("date", context.period.end);
}

export function dayMarkers(
	input: CardInput,
	readsAggregates: boolean,
): CardMarkers {
	return markersOf(input.coverage, readsAggregates);
}

export function dayCsvName(context: ReportContext, cardId: string): string {
	return csvName(DAY_SLUG, cardId.replace(/_/g, "-"), context.period.key);
}

export function lastYearFrom(context: ReportContext): IsoDate {
	return (
		boundOf("day", context.period.end, "last_year")?.from ??
		addDays(context.period.end, -364)
	);
}

export function youngStoreState(
	input: CardInput,
	storeId: string,
): string | null {
	return sharedYoungStoreState(
		input.coverage,
		storeId,
		lastYearFrom(input.context),
	);
}

export function youngStoreNote(input: CardInput): SentencePart | null {
	return sharedYoungStoreNote(
		input.context,
		input.coverage,
		lastYearFrom(input.context),
	);
}

export function decompositionInputs(
	input: CardInput,
	against: Comparison,
): { current: DecompositionSums; reference: DecompositionSums } | null {
	return sharedDecompositionInputs(compareRows(input), input.coverage, against);
}

export function storeTotals(input: CardInput): readonly StoreTotals[] {
	return sharedStoreTotals(input.context, compareRows(input));
}

export {
	changeCell,
	comparisonOf,
	isMultiStore,
	pickFrom,
	type StoreTotals,
	sumsOfRows,
	totalsOf,
} from "../../model/totals.js";

export function hourAxis(startMinutes: number): readonly number[] {
	const startHour = Math.floor(startMinutes / 60) % 24;
	return Array.from({ length: 24 }, (_, offset) => (startHour + offset) % 24);
}
