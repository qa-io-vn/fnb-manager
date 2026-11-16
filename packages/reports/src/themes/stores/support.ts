import type { AnalyticsRow } from "../../contract/functions.js";
import type { DateRange, IsoDate } from "../../contract/values.js";
import { COVERAGE_CALL_KEY, type ReportStore } from "../../definition.js";
import { type CardModel, csvName, type SeriesTone } from "../../model/card.js";
import type { CoverageModel } from "../../model/coverage.js";
import type { ValueUnit } from "../../model/values.js";
import { part } from "../../model/values.js";
import { addDays, daysBetween, minDate } from "../../period/dates.js";
import { SINCE_OPENING_BLOCK_DAYS } from "../../reports/year/rules.js";
import {
	KEY_PREFIX_WILDCARD,
	SINCE_CALL_PREFIX,
	sinceCallKey,
} from "../../reports/year/support.js";
import type { ThemeContext } from "../context.js";
import type { ThemeRow } from "../contract.js";
import {
	type RangeTotalsRow,
	type ReportCallSpec,
	rangeTotalsCall,
	reportCall,
	type ThemeCallResults,
	type ThemeCardInput,
	TOTALS_CALL_KEY,
	TOTALS_LIKE_FOR_LIKE_KEYS,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";
import { type RangeSeriesGrain, seriesGrain } from "../range.js";
import { themeMarkers } from "../support.js";
import { storesKeys } from "./keys.js";

export const STORES_SLUG = "so-sanh";
export const MIN_COMPARED_STORES = 2;
export const DAY_GRAIN_MAX_DAYS = 92;
export const SINCE_MAX_WEEKS = 26;

export const storesCalls = {
	coverage: COVERAGE_CALL_KEY,
	totals: TOTALS_CALL_KEY,
	totalsLikeForLike: TOTALS_LIKE_FOR_LIKE_KEYS.previous,
	productivity: "productivity",
	days: "days",
} as const;

export const SINCE_CALLS = `${SINCE_CALL_PREFIX}${KEY_PREFIX_WILDCARD}`;

export const storesNeeds = {
	kpis: [
		storesCalls.coverage,
		storesCalls.totals,
		storesCalls.totalsLikeForLike,
		storesCalls.productivity,
	],
	sameDay: [storesCalls.coverage, storesCalls.days],
	sinceOpening: [storesCalls.coverage, SINCE_CALLS],
} as const;

export type SeriesRow = AnalyticsRow<"period_series">;
export type ProductivityRow = ThemeRow<"opening_productivity">;

export function comparesStores(context: Pick<ThemeContext, "stores">): boolean {
	return context.stores.length >= MIN_COMPARED_STORES;
}

export function daysGrain(days: number, storeCount: number): RangeSeriesGrain {
	return seriesGrain(
		days,
		storeCount,
		true,
		days <= DAY_GRAIN_MAX_DAYS ? "day" : "week",
	);
}

export function storesPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const coverage = themeCoverageCall(context);
	if (!comparesStores(context)) return [coverage];
	const storeIds = themeStoreIds(context);
	const { range } = context;
	return [
		coverage,
		rangeTotalsCall(storesCalls.totals, storeIds, [range, range.previous]),
		reportCall(storesCalls.productivity, "opening_productivity", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
		}),
		reportCall(storesCalls.days, "period_series", {
			store_ids: storeIds,
			grain: daysGrain(range.days, storeIds.length),
			from_date: range.from,
			to_date: range.to,
			include_stores: true,
		}),
	];
}

export interface SinceStore {
	readonly store: ReportStore;
	readonly historyStart: IsoDate | null;
	readonly completeWeeks: number;
}

export interface SincePlan {
	readonly weeks: number;
	readonly stores: readonly SinceStore[];
	readonly youngest: SinceStore | null;
}

export function completeWeeksSince(
	historyStart: IsoDate | null,
	asOf: IsoDate,
): number {
	if (historyStart === null || historyStart > asOf) return 0;
	return Math.floor(
		(daysBetween(historyStart, asOf) + 1) / SINCE_OPENING_BLOCK_DAYS,
	);
}

export function sincePlan(
	context: Pick<ThemeContext, "stores" | "range">,
	coverage: CoverageModel,
): SincePlan {
	const stores = context.stores.map((store): SinceStore => {
		const historyStart = coverage.historyStart(store.id);
		return {
			store,
			historyStart,
			completeWeeks: completeWeeksSince(historyStart, context.range.asOf),
		};
	});
	let youngest: SinceStore | null = null;
	for (const entry of stores) {
		if (entry.completeWeeks === 0 || entry.historyStart === null) continue;
		if (
			youngest === null ||
			(youngest.historyStart !== null &&
				entry.historyStart > youngest.historyStart)
		) {
			youngest = entry;
		}
	}
	return {
		weeks:
			youngest === null ? 0 : Math.min(SINCE_MAX_WEEKS, youngest.completeWeeks),
		stores,
		youngest,
	};
}

export function sinceWindow(
	historyStart: IsoDate,
	weeks: number,
	asOf: IsoDate,
): DateRange {
	return {
		from: historyStart,
		to: minDate(
			addDays(historyStart, SINCE_OPENING_BLOCK_DAYS * weeks - 1),
			asOf,
		),
	};
}

export function likeForLikeTotalsCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	const { range } = context;
	const covered = coverage.forReference(range.previous.from);
	if (covered.state !== "partial") return [];
	return [
		rangeTotalsCall(storesCalls.totalsLikeForLike, covered.coveredStoreIds, [
			range,
			range.previous,
		]),
	];
}

export function sinceCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	const plan = sincePlan(context, coverage);
	if (plan.weeks === 0) return [];
	return plan.stores.flatMap((entry) => {
		if (entry.completeWeeks === 0 || entry.historyStart === null) return [];
		const window = sinceWindow(
			entry.historyStart,
			plan.weeks,
			context.range.asOf,
		);
		return [
			reportCall(sinceCallKey(entry.store.id), "period_series", {
				store_ids: [entry.store.id],
				grain: "day",
				from_date: window.from,
				to_date: window.to,
				include_stores: false,
			}),
		];
	});
}

export function storesFollowUpCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	if (!comparesStores(context)) return [];
	return [
		...likeForLikeTotalsCalls(context, coverage),
		...sinceCalls(context, coverage),
	];
}

export function totalsRowsOf(
	results: ThemeCallResults,
	key: string = storesCalls.totals,
): readonly RangeTotalsRow[] {
	return results.rows(key, "range_totals") ?? [];
}

export function productivityRowsOf(
	results: ThemeCallResults,
): readonly ProductivityRow[] {
	return results.rows(storesCalls.productivity, "opening_productivity") ?? [];
}

export function dayRowsOf(results: ThemeCallResults): readonly SeriesRow[] {
	return results.rows(storesCalls.days, "period_series") ?? [];
}

export function sinceRowsOf(
	results: ThemeCallResults,
	storeId: string,
): readonly SeriesRow[] {
	const rows = results.rows(sinceCallKey(storeId), "period_series") ?? [];
	const own = rows.filter((row) => row.store_id === storeId);
	return own.length > 0 ? own : rows.filter((row) => row.store_id === null);
}

export const STORE_TONES: readonly SeriesTone[] = [
	"primary",
	"secondary",
	"tertiary",
	"quaternary",
	"quinary",
];

export function storeTone(index: number): SeriesTone {
	return STORE_TONES[index % STORE_TONES.length] ?? "primary";
}

export function storeDashed(index: number): boolean {
	return index >= STORE_TONES.length;
}

export function storesCsvName(context: ThemeContext, card: string): string {
	return csvName(STORES_SLUG, card, context.range.key);
}

export interface NeedTwoCard {
	readonly id: string;
	readonly titleKey: string;
	readonly metricId: string;
	readonly relatedMetricIds: readonly string[];
	readonly unit: ValueUnit;
}

export function needTwoCard(
	input: ThemeCardInput,
	card: NeedTwoCard,
): CardModel {
	return {
		id: card.id,
		titleKey: card.titleKey,
		subtitle: null,
		metricId: card.metricId,
		relatedMetricIds: card.relatedMetricIds,
		headline: { value: null, unit: card.unit, caption: null },
		comparisons: [],
		decomposition: null,
		narrative: [part(storesKeys.needTwo)],
		tables: [],
		chart: null,
		notice: null,
		markers: themeMarkers(input, false),
		csvName: storesCsvName(input.context, card.id),
	};
}
