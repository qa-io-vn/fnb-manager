import type { AnalyticsRow } from "../../contract/functions.js";
import type { HolidayKind, IsoDate } from "../../contract/values.js";
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
	type NoticeModel,
} from "../../model/card.js";
import type { PeriodReferenceKind } from "../../model/comparison.js";
import type { CoverageModel } from "../../model/coverage.js";
import {
	lastYearLabelKey,
	previousLabelKey,
	reportKeys,
} from "../../model/keys.js";
import { sumMoney, sumQuantity } from "../../model/money.js";
import { markersOf, type TotalsRow } from "../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../model/values.js";
import { boundOf } from "../../period/bounds.js";
import {
	addDays,
	datesBetween,
	daysBetween,
	isoWeekday,
} from "../../period/dates.js";
import { weekKeys } from "./keys.js";

export const WEEK_SLUG = "tuan";
export const WEEK_DAYS = 7;
export const BASELINE_WEEKS = 8;
export const SERIES_LEAD_DAYS = 28;
export const VELOCITY_HISTORY_DAYS = 55;

export const WEEK_METRIC_IDS = [
	"discount_rate",
	"voucher_invoice_share",
] as const;

export const weekCalls = {
	coverage: COVERAGE_CALL_KEY,
	compare: "compare",
	days: "days",
	baselines: "baselines",
	velocity: "velocity",
	velocityCovered: "velocityCovered",
	items: "items",
	promotions: "promotions",
	promotionsPrevious: "promotionsPrevious",
	metrics: "metrics",
} as const;

const compareFollowUps = [
	COMPARE_LIKE_FOR_LIKE_KEYS.previous,
	COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
] as const;
const metricFollowUps = [
	METRICS_LIKE_FOR_LIKE_KEYS.previous,
	METRICS_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const weekNeeds = {
	totals: [
		weekCalls.coverage,
		weekCalls.compare,
		weekCalls.days,
		...compareFollowUps,
	],
	curve: [weekCalls.coverage, weekCalls.days],
	movers: [weekCalls.coverage, weekCalls.velocity, weekCalls.velocityCovered],
	categories: [weekCalls.coverage, weekCalls.items],
	promotions: [
		weekCalls.coverage,
		weekCalls.compare,
		weekCalls.metrics,
		weekCalls.promotions,
		weekCalls.promotionsPrevious,
		...compareFollowUps,
		...metricFollowUps,
	],
	days: [weekCalls.coverage, weekCalls.days, weekCalls.baselines],
} as const;

export interface WeekRange {
	readonly monday: IsoDate;
	readonly end: IsoDate;
	readonly elapsed: number;
}

export function weekRange(context: Pick<ReportContext, "period">): WeekRange {
	const monday = context.period.from;
	const end = context.period.end;
	return { monday, end, elapsed: daysBetween(monday, end) };
}

export function lastWeekRange(context: Pick<ReportContext, "period">): {
	readonly from: IsoDate;
	readonly to: IsoDate;
} {
	const { monday, end } = weekRange(context);
	return { from: addDays(monday, -WEEK_DAYS), to: addDays(end, -WEEK_DAYS) };
}

export function velocityReferenceDate(
	context: Pick<ReportContext, "period">,
): IsoDate {
	return addDays(context.period.end, -VELOCITY_HISTORY_DAYS);
}

export function weekPrimaryCalls(context: ReportContext): readonly CallSpec[] {
	const storeIds = storeIdsOf(context);
	const { monday, end } = weekRange(context);
	const lastWeek = lastWeekRange(context);
	return [
		coverageCall(context),
		call(weekCalls.compare, "period_compare_by_store", {
			store_ids: storeIds,
			grain: "week",
			anchor: end,
		}),
		call(weekCalls.days, "period_series", {
			store_ids: storeIds,
			grain: "day",
			from_date: addDays(monday, -SERIES_LEAD_DAYS),
			to_date: end,
		}),
		call(weekCalls.baselines, "daily_baselines", {
			store_ids: storeIds,
			from_date: monday,
			to_date: end,
			weeks: BASELINE_WEEKS,
		}),
		call(weekCalls.velocity, "item_velocity", {
			store_ids: storeIds,
			as_of_date: end,
		}),
		call(weekCalls.items, "item_summary", {
			store_ids: storeIds,
			from_date: monday,
			to_date: end,
			compare_from: lastWeek.from,
			compare_to: lastWeek.to,
		}),
		call(weekCalls.promotions, "promotion_summary", {
			store_ids: storeIds,
			from_date: monday,
			to_date: end,
		}),
		call(weekCalls.promotionsPrevious, "promotion_summary", {
			store_ids: storeIds,
			from_date: lastWeek.from,
			to_date: lastWeek.to,
		}),
		call(weekCalls.metrics, "metric_compare", {
			store_ids: storeIds,
			metric_ids: [...WEEK_METRIC_IDS],
			grain: "week",
			anchor: end,
		}),
	];
}

export function weekFollowUpCalls(
	context: ReportContext,
	coverage: CoverageModel,
): readonly CallSpec[] {
	const calls: CallSpec[] = [
		...likeForLikeCalls(context, coverage, {
			grain: "week",
			metricIds: WEEK_METRIC_IDS,
		}),
	];
	const velocity = coverage.forReference(velocityReferenceDate(context));
	if (velocity.state === "partial") {
		calls.push(
			call(weekCalls.velocityCovered, "item_velocity", {
				store_ids: [...velocity.coveredStoreIds],
				as_of_date: context.period.end,
			}),
		);
	}
	return calls;
}

export type DayRow = AnalyticsRow<"period_series">;
export type MoneyUnit = "money" | "count" | "items";

export function compareRows(input: CardInput): readonly TotalsRow[] {
	return input.results.rows(weekCalls.compare, "period_compare_by_store") ?? [];
}

export function metricRows(
	input: CardInput,
): readonly AnalyticsRow<"metric_compare">[] {
	return input.results.rows(weekCalls.metrics, "metric_compare") ?? [];
}

export interface WeekDays {
	readonly rows: readonly DayRow[];
	all(date: IsoDate): DayRow | undefined;
	store(storeId: string, date: IsoDate): DayRow | undefined;
	holidayKind(date: IsoDate): HolidayKind | null;
	value(
		storeIds: readonly string[] | null,
		date: IsoDate,
		pick: (row: DayRow) => number | null,
		unit: MoneyUnit,
	): number | null;
}

function dayKey(storeId: string | null, date: IsoDate): string {
	return `${storeId ?? ""}|${date}`;
}

function hasData(row: DayRow | undefined): row is DayRow {
	return row !== undefined && row.days_with_data > 0;
}

export function sumIn(
	unit: MoneyUnit,
	values: readonly (number | null)[],
): number {
	if (unit === "money") return sumMoney(values);
	if (unit === "items") return sumQuantity(values);
	return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

export function weekDays(rows: readonly DayRow[]): WeekDays {
	const byKey = new Map<string, DayRow>();
	for (const row of rows)
		byKey.set(dayKey(row.store_id, row.bucket_start), row);
	return {
		rows,
		all: (date) => byKey.get(dayKey(null, date)),
		store: (storeId, date) => byKey.get(dayKey(storeId, date)),
		holidayKind: (date) => byKey.get(dayKey(null, date))?.holiday_kind ?? null,
		value(storeIds, date, pick, unit) {
			if (storeIds === null) {
				const row = byKey.get(dayKey(null, date));
				return hasData(row) ? pick(row) : null;
			}
			const present = storeIds
				.map((id) => byKey.get(dayKey(id, date)))
				.filter(hasData);
			if (present.length === 0) return null;
			return sumIn(
				unit,
				present.map((row) => pick(row)),
			);
		},
	};
}

export function dayRowsOf(input: CardInput): WeekDays {
	return weekDays(input.results.rows(weekCalls.days, "period_series") ?? []);
}

export function weekDates(context: Pick<ReportContext, "period">): IsoDate[] {
	const { monday, end } = weekRange(context);
	return datesBetween(monday, end);
}

export function fullWeekDates(
	context: Pick<ReportContext, "period">,
): IsoDate[] {
	return datesBetween(context.period.from, context.period.to);
}

export function weekdayValue(date: IsoDate): TypedValue {
	return textValue("weekday", String(isoWeekday(date)));
}

export function weekValue(context: Pick<ReportContext, "period">): TypedValue {
	return textValue("isoWeek", context.period.key);
}

export function weekLabels(): Readonly<
	Record<PeriodReferenceKind, SentencePart>
> {
	return {
		previous: part(previousLabelKey("week")),
		last_year: part(lastYearLabelKey("week")),
		baseline: part(reportKeys.compare.baseline),
	};
}

export function weekMarkers(
	input: CardInput,
	readsAggregates: boolean,
): CardMarkers {
	return markersOf(input.coverage, readsAggregates);
}

export function weekCsvName(
	context: Pick<ReportContext, "period">,
	cardId: string,
): string {
	return csvName(WEEK_SLUG, cardId.replace(/_/g, "-"), context.period.key);
}

export function lastYearFrom(context: Pick<ReportContext, "period">): IsoDate {
	return (
		boundOf("week", context.period.end, "last_year")?.from ??
		addDays(context.period.from, -364)
	);
}

export function partialCaption(
	context: Pick<ReportContext, "period">,
): SentencePart | null {
	return context.period.complete
		? null
		: part(weekKeys.partial, { end: textValue("date", context.period.end) });
}

export function noDataNotice(): NoticeModel {
	return { tone: "info", part: part(weekKeys.noDataNotice), action: null };
}

export function likeForLikeStores(
	coverage: CoverageModel,
	comparison: Comparison | null,
): readonly string[] | null {
	if (
		comparison === null ||
		comparison.basis !== "like_for_like" ||
		comparison.range === null
	) {
		return null;
	}
	return coverage.forReference(comparison.range.from).coveredStoreIds;
}

export function likeForLikeNote(
	comparison: Comparison | null,
): SentencePart | null {
	if (comparison === null || comparison.basis !== "like_for_like") return null;
	return part(reportKeys.clause.coverage.likeForLike, {
		covered: numberValue("count", comparison.coveredStores),
		total: numberValue("count", comparison.totalStores),
	});
}

export function byEarlierDate<Row extends { readonly date: IsoDate }>(
	left: Row,
	right: Row,
): number {
	return left.date < right.date ? -1 : left.date > right.date ? 1 : 0;
}
