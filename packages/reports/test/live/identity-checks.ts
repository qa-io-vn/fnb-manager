import {
	type AnalyticsRow,
	addDays,
	type DateRange,
	firstOfYear,
	type IsoDate,
	type ThemeRow,
} from "../../src/index.js";
import type { TimedCall } from "./postgres-rpc-client.js";

export type PromotionSummaryRow = AnalyticsRow<"promotion_summary">;
export type ComplianceRow = ThemeRow<"promotion_compliance">;
export type DiscountDaysRow = ThemeRow<"item_discount_days">;
export type QualitySummaryRow = ThemeRow<"data_quality_summary">;
export type QualityItemRow = ThemeRow<"data_quality_items">;

export const CALL_BUDGET_MS: Readonly<Record<string, number>> = {
	range_totals: 50,
	opening_productivity: 50,
	hour_weekday_heatmap: 50,
	menu_engineering: 50,
	modifier_summary: 50,
	payment_summary: 50,
	analytics_catch_up_status: 50,
	data_quality_payments: 50,
	shift_review: 100,
	hour_profile: 150,
	item_margins: 150,
	data_quality_items: 150,
	store_coverage: 200,
	item_summary: 200,
	basket_pairs: 300,
	promotion_summary: 300,
	item_discount_days: 300,
	data_quality_summary: 300,
	item_attach: 400,
	promotion_days: 400,
	promotion_catalogue: 400,
	shift_adjustments: 400,
	promotion_lift: 500,
};
export const PAGE_BUDGET_MS = 600;
export const ANY_CALL_BUDGET_MS = 1_500;
export const TIMED_SPANS = ["default", "longest"] as const;
export const PAGE_OVER_BUDGET = "page";

export type TimedSpan = (typeof TIMED_SPANS)[number];

const INVOICE_TOTAL_KIND = "invoice_total";
const AMOUNT_EPSILON = 0.005;

export interface PromotionIdentities {
	readonly promotions: number;
	readonly keysAgree: boolean;
	readonly checkedRowsAgree: boolean;
	readonly flaggedWithinDiscount: boolean;
}

export interface FlaggedShifts {
	readonly reviewFlagged: number;
	readonly cashFlagged: number;
	readonly agree: boolean;
}

export interface CatalogueModifierFacts {
	readonly summaryRows: number;
	readonly catalogueModifierLines: number;
	readonly linesAllZero: boolean;
	readonly qualityItems: number;
	readonly catalogueModifierItems: number;
}

export function overBudgetCalls(
	calls: readonly TimedCall[],
	span: TimedSpan,
): string[] {
	const over = calls
		.filter((call) => {
			if (call.milliseconds >= ANY_CALL_BUDGET_MS) return true;
			const budget = CALL_BUDGET_MS[call.fn];
			return (
				span === "default" && budget !== undefined && call.milliseconds > budget
			);
		})
		.map((call) => call.fn);
	const slowest = Math.max(0, ...calls.map((call) => call.milliseconds));
	return span === "default" && slowest >= PAGE_BUDGET_MS
		? [...over, PAGE_OVER_BUDGET]
		: over;
}

export function missingFunctions(
	expected: Iterable<string>,
	calls: readonly TimedCall[],
): string[] {
	const timed = new Set(calls.map((call) => call.fn));
	return [...new Set(expected)].filter((fn) => !timed.has(fn));
}

export function promotionYear(asOf: IsoDate): DateRange {
	const from = firstOfYear(asOf);
	if (from !== asOf) return { from, to: asOf };
	const lastYearEnd = addDays(asOf, -1);
	return { from: firstOfYear(lastYearEnd), to: lastYearEnd };
}

function promotionIdOf(row: {
	readonly promotion_kind: string;
	readonly promotion_key: string;
}): string {
	return JSON.stringify([row.promotion_kind, row.promotion_key]);
}

function checkedRowsOf(promotion: PromotionSummaryRow): number | null {
	return promotion.promotion_kind === "item"
		? promotion.lines
		: promotion.invoices;
}

export function promotionIdentities(
	summary: readonly PromotionSummaryRow[],
	compliance: readonly ComplianceRow[],
): PromotionIdentities {
	const promotions = new Map(summary.map((row) => [promotionIdOf(row), row]));
	const checked = compliance.filter(
		(row) => row.promotion_kind !== INVOICE_TOTAL_KIND,
	);
	const checkedIds = new Set(checked.map(promotionIdOf));
	const keysAgree =
		promotions.size === summary.length &&
		checkedIds.size === checked.length &&
		checkedIds.size === promotions.size &&
		[...promotions.keys()].every((id) => checkedIds.has(id));
	let checkedRowsAgree = true;
	let flaggedWithinDiscount = true;
	for (const row of checked) {
		const promotion = promotions.get(promotionIdOf(row));
		if (promotion === undefined) {
			checkedRowsAgree = false;
			flaggedWithinDiscount = false;
			continue;
		}
		if (row.checked_rows !== checkedRowsOf(promotion)) {
			checkedRowsAgree = false;
		}
		const flagged =
			(row.over_cap_discount_amount ?? 0) + (row.full_discount_amount ?? 0);
		if (flagged > promotion.discount_amount + AMOUNT_EPSILON) {
			flaggedWithinDiscount = false;
		}
	}
	return {
		promotions: promotions.size,
		keysAgree,
		checkedRowsAgree,
		flaggedWithinDiscount,
	};
}

export function itemsWithoutDiscount(rows: readonly DiscountDaysRow[]): number {
	return rows.filter(
		(row) => row.price_discount_days + row.gift_days + row.voucher_days === 0,
	).length;
}

export function flaggedShifts(
	review: readonly { readonly shift_id: string; readonly flagged: boolean }[],
	cashFlags: readonly { readonly shift_id: string }[],
): FlaggedShifts {
	const flaggedRows = review.filter((row) => row.flagged);
	const reviewIds = new Set(flaggedRows.map((row) => row.shift_id));
	const cashIds = new Set(cashFlags.map((row) => row.shift_id));
	return {
		reviewFlagged: flaggedRows.length,
		cashFlagged: cashFlags.length,
		agree:
			reviewIds.size === flaggedRows.length &&
			cashIds.size === cashFlags.length &&
			cashIds.size === reviewIds.size &&
			[...cashIds].every((id) => reviewIds.has(id)),
	};
}

export function catalogueModifierFacts(
	summary: readonly QualitySummaryRow[],
	items: readonly QualityItemRow[],
): CatalogueModifierFacts {
	return {
		summaryRows: summary.length,
		catalogueModifierLines: summary
			.filter((row) => row.store_id !== null)
			.reduce((total, row) => total + row.catalogue_modifier_lines, 0),
		linesAllZero: summary.every((row) => row.catalogue_modifier_lines === 0),
		qualityItems: items.length,
		catalogueModifierItems: items.filter((row) => row.catalogue_modifier)
			.length,
	};
}
