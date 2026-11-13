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
	type ReportContext,
	type ReportStore,
	storeIdsOf,
} from "../../definition.js";
import { type CardMarkers, csvName } from "../../model/card.js";
import type { CoverageModel } from "../../model/coverage.js";
import { lastYearLabelKey } from "../../model/keys.js";
import { markersOf, type TotalsRow } from "../../model/totals.js";
import {
	messageValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../model/values.js";
import { monthOf } from "../../period/dates.js";
import { monthLabelKey } from "./keys.js";
import {
	type HistoryStartOf,
	type LifecycleRow,
	monthKeyOf,
	opensWithinYear,
	SeriesIndex,
	type SeriesRow,
	type YearBounds,
	yearBounds,
} from "./rules.js";

export const YEAR_SLUG = "nam";
export const SINCE_CALL_PREFIX = "since.";
export const KEY_PREFIX_WILDCARD = "*";

export const yearCalls = {
	coverage: COVERAGE_CALL_KEY,
	compare: "compare",
	months: "months",
	weeks: "weeks",
	weekdays: "weekdays",
	lifecycle: "lifecycle",
	lifecycleCovered: "lifecycleCovered",
} as const;

const compareFollowUps = [
	COMPARE_LIKE_FOR_LIKE_KEYS.previous,
	COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const yearNeeds = {
	matrix: [yearCalls.coverage, yearCalls.months],
	growth: [yearCalls.coverage, yearCalls.months],
	seasonality: [
		yearCalls.coverage,
		yearCalls.months,
		yearCalls.weeks,
		yearCalls.weekdays,
	],
	ticket: [
		yearCalls.coverage,
		yearCalls.compare,
		yearCalls.months,
		...compareFollowUps,
	],
	lifecycle: [
		yearCalls.coverage,
		yearCalls.lifecycle,
		yearCalls.lifecycleCovered,
	],
	yearOverYear: [
		yearCalls.coverage,
		yearCalls.compare,
		yearCalls.months,
		...compareFollowUps,
	],
	since: [yearCalls.coverage, `${SINCE_CALL_PREFIX}${KEY_PREFIX_WILDCARD}`],
} as const;

export function sinceCallKey(storeId: string): string {
	return `${SINCE_CALL_PREFIX}${storeId}`;
}

export function boundsOf(context: Pick<ReportContext, "period">): YearBounds {
	return yearBounds(context.period);
}

export function historyStartOf(coverage: CoverageModel): HistoryStartOf {
	return (storeId) => coverage.historyStart(storeId);
}

export interface SinceOpeningStore {
	readonly store: ReportStore;
	readonly historyStart: IsoDate;
}

export function sinceOpeningStores(
	context: Pick<ReportContext, "stores" | "period">,
	coverage: CoverageModel,
): SinceOpeningStore[] {
	const { yearEnd } = boundsOf(context);
	return context.stores.flatMap((store) => {
		const start = coverage.historyStart(store.id);
		return opensWithinYear(start, yearEnd)
			? [{ store, historyStart: start }]
			: [];
	});
}

export function yearPrimaryCalls(context: ReportContext): readonly CallSpec[] {
	const storeIds = storeIdsOf(context);
	const bounds = boundsOf(context);
	return [
		coverageCall(context),
		call(yearCalls.compare, "period_compare_by_store", {
			store_ids: storeIds,
			grain: "year",
			anchor: bounds.yearEnd,
		}),
		call(yearCalls.months, "period_series", {
			store_ids: storeIds,
			grain: "month",
			from_date: bounds.firstYearStart,
			to_date: bounds.yearEnd,
		}),
		call(yearCalls.weeks, "period_series", {
			store_ids: storeIds,
			grain: "week",
			from_date: bounds.lastYearStart,
			to_date: bounds.yearEnd,
			include_stores: false,
		}),
		call(yearCalls.weekdays, "period_series", {
			store_ids: storeIds,
			grain: "weekday",
			from_date: bounds.yearStart,
			to_date: bounds.yearEnd,
			include_stores: false,
		}),
		call(yearCalls.lifecycle, "item_lifecycle", {
			store_ids: storeIds,
			as_of_date: bounds.yearEnd,
		}),
	];
}

export function yearFollowUpCalls(
	context: ReportContext,
	coverage: CoverageModel,
): readonly CallSpec[] {
	const bounds = boundsOf(context);
	const calls: CallSpec[] = [
		...likeForLikeCalls(context, coverage, { grain: "year" }),
	];
	const lastYear = coverage.forReference(bounds.lastYearStart);
	if (lastYear.state === "partial") {
		calls.push(
			call(yearCalls.lifecycleCovered, "item_lifecycle", {
				store_ids: [...lastYear.coveredStoreIds],
				as_of_date: bounds.yearEnd,
			}),
		);
	}
	for (const { store, historyStart } of sinceOpeningStores(context, coverage)) {
		calls.push(
			call(sinceCallKey(store.id), "period_series", {
				store_ids: [store.id],
				grain: "day",
				from_date: historyStart,
				to_date: bounds.yearEnd,
			}),
		);
	}
	return calls;
}

export function compareRows(input: CardInput): readonly TotalsRow[] {
	return input.results.rows(yearCalls.compare, "period_compare_by_store") ?? [];
}

export function monthIndex(input: CardInput): SeriesIndex {
	return new SeriesIndex(
		input.results.rows(yearCalls.months, "period_series") ?? [],
	);
}

export function allStoreRows(
	rows: readonly SeriesRow[] | undefined,
): SeriesRow[] {
	return (rows ?? [])
		.filter((row) => row.store_id === null)
		.sort((left, right) =>
			left.bucket_start < right.bucket_start
				? -1
				: left.bucket_start > right.bucket_start
					? 1
					: (left.weekday ?? 0) - (right.weekday ?? 0),
		);
}

export function weekRows(input: CardInput): SeriesRow[] {
	return allStoreRows(input.results.rows(yearCalls.weeks, "period_series"));
}

export function weekdayRows(input: CardInput): SeriesRow[] {
	return allStoreRows(input.results.rows(yearCalls.weekdays, "period_series"));
}

export function lifecycleRows(
	input: CardInput,
	covered: boolean,
): readonly LifecycleRow[] {
	return (
		input.results.rows(
			covered ? yearCalls.lifecycleCovered : yearCalls.lifecycle,
			"item_lifecycle",
		) ?? []
	);
}

export function sinceRows(
	input: CardInput,
	storeId: string,
): readonly AnalyticsRow<"period_series">[] {
	const rows = input.results.rows(sinceCallKey(storeId), "period_series") ?? [];
	const own = rows.filter((row) => row.store_id === storeId);
	return own.length > 0 ? own : rows.filter((row) => row.store_id === null);
}

export function yearValue(bounds: YearBounds): TypedValue {
	return textValue("year", String(bounds.year));
}

export function lastYearValue(bounds: YearBounds): TypedValue {
	return textValue("year", String(bounds.year - 1));
}

export function monthValue(monthStart: IsoDate): TypedValue {
	return textValue("month", monthKeyOf(monthStart));
}

export function monthOfYearValue(monthStart: IsoDate): TypedValue {
	return messageValue(monthLabelKey(monthOf(monthStart)));
}

export function lastYearLabels(): Readonly<
	Record<"previous" | "last_year" | "baseline", SentencePart>
> {
	const label = part(lastYearLabelKey("year"));
	return { previous: label, last_year: label, baseline: label };
}

export function yearMarkers(
	input: CardInput,
	readsAggregates: boolean,
): CardMarkers {
	return markersOf(input.coverage, readsAggregates);
}

export function yearCsvName(context: ReportContext, cardId: string): string {
	return csvName(YEAR_SLUG, cardId.replace(/_/g, "-"), context.period.key);
}
