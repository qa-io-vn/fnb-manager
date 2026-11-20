import type { AnalyticsRow } from "../../contract/functions.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import { ratio } from "../../model/numeric.js";
import type { ThemeContext } from "../context.js";
import type { ThemeRow } from "../contract.js";
import {
	type ReportCallSpec,
	reportCall,
	type ThemeCallResults,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";
import { type RangeSeriesGrain, seriesGrain } from "../range.js";

export const QUALITY_SLUG = "chat-luong";
export const COST_TABLE_ITEMS = 20;
export const SHARE_DIGITS = 6;

export const qualityCalls = {
	coverage: COVERAGE_CALL_KEY,
	days: "days",
	items: "items",
	summary: "summary",
	payments: "payments",
	margins: "margins",
	railFlags: "railFlags",
} as const;

export const qualityNeeds = {
	uncategorised: [qualityCalls.coverage, qualityCalls.items],
	costs: [qualityCalls.coverage, qualityCalls.items, qualityCalls.margins],
	verification: [qualityCalls.coverage, qualityCalls.days],
	modifiers: [qualityCalls.coverage, qualityCalls.summary],
	payments: [qualityCalls.coverage, qualityCalls.payments],
	customers: [qualityCalls.coverage, qualityCalls.summary],
	compliance: [
		qualityCalls.coverage,
		qualityCalls.summary,
		qualityCalls.railFlags,
	],
} as const;

export type QualityItemRow = ThemeRow<"data_quality_items">;
export type QualitySummaryRow = ThemeRow<"data_quality_summary">;
export type QualityPaymentRow = ThemeRow<"data_quality_payments">;
export type DaySeriesRow = AnalyticsRow<"period_series">;
export type QualityMarginRow = ThemeRow<"item_margins">;
export type QualityRailFlagRow = ThemeRow<"loyalty_rail_flags">;

export function isUncategorisedItem(row: QualityItemRow): boolean {
	return (
		!row.type_known &&
		!row.catalogue_modifier &&
		row.override_type_external_id === null
	);
}

export function isTypeWithoutRole(row: QualityItemRow): boolean {
	return row.type_known && row.role === null && !row.catalogue_modifier;
}

export function isUncostedItem(row: QualityItemRow): boolean {
	return !row.cost_known && !row.catalogue_modifier;
}

export function daysGrain(
	context: Pick<ThemeContext, "range" | "stores">,
): RangeSeriesGrain {
	return seriesGrain(context.range.days, context.stores.length, true, "day");
}

export function qualityPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	const storeRange = {
		store_ids: storeIds,
		from_date: range.from,
		to_date: range.to,
	};
	return [
		themeCoverageCall(context),
		reportCall(qualityCalls.days, "period_series", {
			store_ids: storeIds,
			grain: daysGrain(context),
			from_date: range.from,
			to_date: range.to,
			include_stores: true,
		}),
		reportCall(qualityCalls.items, "data_quality_items", storeRange),
		reportCall(qualityCalls.summary, "data_quality_summary", storeRange),
		reportCall(qualityCalls.payments, "data_quality_payments", storeRange),
		reportCall(qualityCalls.margins, "item_margins", storeRange),
		reportCall(qualityCalls.railFlags, "loyalty_rail_flags", {
			p_store_ids: storeIds,
		}),
	];
}

export function qualityFollowUpCalls(): readonly ReportCallSpec[] {
	return [];
}

export function railFlaggedStoreIds(
	results: ThemeCallResults,
): ReadonlySet<string> {
	return new Set(
		(results.rows(qualityCalls.railFlags, "loyalty_rail_flags") ?? [])
			.filter((row) => row.flagged)
			.flatMap((row) => (row.store_id === null ? [] : [row.store_id])),
	);
}

export function itemRows(results: ThemeCallResults): readonly QualityItemRow[] {
	return results.rows(qualityCalls.items, "data_quality_items") ?? [];
}

export function summaryRows(
	results: ThemeCallResults,
): readonly QualitySummaryRow[] {
	return results.rows(qualityCalls.summary, "data_quality_summary") ?? [];
}

export function allStoresSummary(
	results: ThemeCallResults,
): QualitySummaryRow | undefined {
	return summaryRows(results).find((row) => row.store_id === null);
}

export function storeSummaries(
	context: Pick<ThemeContext, "stores">,
	results: ThemeCallResults,
): readonly { name: string; row: QualitySummaryRow }[] {
	const byStore = new Map(
		summaryRows(results)
			.filter((row) => row.store_id !== null)
			.map((row) => [row.store_id, row]),
	);
	return context.stores.flatMap((store) => {
		const row = byStore.get(store.id);
		return row === undefined ? [] : [{ name: store.name, row }];
	});
}

export function storeNameOf(
	context: Pick<ThemeContext, "stores">,
	storeId: string | null,
): string | null {
	return context.stores.find((store) => store.id === storeId)?.name ?? null;
}

export function sumOf<T>(
	rows: readonly T[],
	pick: (row: T) => number | null,
): number {
	return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

export function shareOf(part: number, whole: number): number | null {
	return ratio(part, whole, SHARE_DIGITS);
}

export function qualityCsvName(context: ThemeContext, card: string): string {
	return csvName(QUALITY_SLUG, card, context.range.key);
}
