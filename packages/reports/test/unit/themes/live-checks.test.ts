import { describe, expect, it } from "vitest";
import {
	ANY_CALL_BUDGET_MS,
	CALL_BUDGET_MS,
	type ComplianceRow,
	catalogueModifierFacts,
	type DiscountDaysRow,
	flaggedShifts,
	itemsWithoutDiscount,
	missingFunctions,
	overBudgetCalls,
	PAGE_BUDGET_MS,
	PAGE_OVER_BUDGET,
	type PromotionSummaryRow,
	promotionIdentities,
	promotionYear,
	type QualityItemRow,
	type QualitySummaryRow,
} from "../../live/identity-checks.js";
import type { TimedCall } from "../../live/postgres-rpc-client.js";
import { STORE_A, STORE_B } from "../fixtures.js";

function summaryRow(
	values: Partial<PromotionSummaryRow> &
		Pick<PromotionSummaryRow, "promotion_kind" | "promotion_key">,
): PromotionSummaryRow {
	return {
		promotion_name: null,
		invoices: 10,
		lines: null,
		discount_amount: 100_000,
		first_used_on: "2026-01-02",
		last_used_on: "2026-11-01",
		days_used: 5,
		...values,
	};
}

function complianceRow(
	values: Partial<ComplianceRow> &
		Pick<ComplianceRow, "promotion_kind" | "promotion_key" | "checked_rows">,
): ComplianceRow {
	return {
		promotion_name: null,
		max_partial_rate: 0.2,
		over_cap_rows: 0,
		over_cap_discount_amount: 0,
		first_over_cap_on: null,
		last_over_cap_on: null,
		full_discount_rows: 0,
		full_discount_amount: 0,
		first_full_discount_on: null,
		last_full_discount_on: null,
		...values,
	};
}

function discountDaysRow(values: Partial<DiscountDaysRow>): DiscountDaysRow {
	return {
		item_external_id: "ITEM-1",
		item_name: "Item 1",
		price_discount_days: 0,
		line_price_discount_days: 0,
		bill_discount_days: 0,
		gift_days: 0,
		voucher_days: 0,
		first_price_discount_on: null,
		last_price_discount_on: null,
		...values,
	};
}

function qualitySummaryRow(
	storeId: string | null,
	catalogueModifierLines: number,
): QualitySummaryRow {
	return {
		store_id: storeId,
		invoices: 100,
		item_lines: 150,
		modifier_lines: 40,
		modifier_line_share: 0.21,
		catalogue_modifier_lines: catalogueModifierLines,
		identified_invoices: 0,
		capture_rate: 0,
		identified_customers: 0,
		loyalty_consents: 0,
		marketing_consents: 0,
		consent_coverage: null,
		unattributed_events: 0,
		e_invoice_status: "unknown",
		tran_no_reset_period: "unknown",
		member_capture_status: "unknown",
		opening_hours_known: false,
		seat_count: null,
		opened_on: null,
		receipt_days: null,
		receipt_restarts_daily: null,
	};
}

function qualityItemRow(catalogueModifier: boolean): QualityItemRow {
	return {
		item_external_id: "ITEM-1",
		item_name: "Item 1",
		pos_account_id: null,
		pos_type_external_id: null,
		pos_type_name: null,
		override_type_external_id: null,
		item_type_external_id: null,
		item_type_name: null,
		type_known: false,
		role: null,
		cost_known: false,
		catalogue_modifier: catalogueModifier,
		quantity: 3,
		net_amount: 90_000,
		net_share: 0.01,
	};
}

function timed(fn: string, milliseconds: number): TimedCall {
	return { fn, milliseconds };
}

describe("the call budgets of the theme live check", () => {
	it("holds each budgeted call to its own budget at the default range", () => {
		expect(
			overBudgetCalls(
				[timed("promotion_lift", 500), timed("promotion_catalogue", 401)],
				"default",
			),
		).toEqual(["promotion_catalogue"]);
		expect(CALL_BUDGET_MS.promotion_lift).toBe(500);
		expect(CALL_BUDGET_MS.promotion_days).toBe(400);
	});

	it("holds every call only to 1,500 ms at the longest range", () => {
		expect(
			overBudgetCalls(
				[timed("range_totals", 1_499), timed("promotion_days", 900)],
				"longest",
			),
		).toEqual([]);
		expect(
			overBudgetCalls([timed("range_totals", ANY_CALL_BUDGET_MS)], "longest"),
		).toEqual(["range_totals"]);
	});

	it("flags a page whose slowest call reaches 600 ms at the default range only", () => {
		expect(
			overBudgetCalls([timed("data_quality_items", PAGE_BUDGET_MS)], "default"),
		).toEqual(["data_quality_items", PAGE_OVER_BUDGET]);
		expect(
			overBudgetCalls([timed("period_series", PAGE_BUDGET_MS)], "longest"),
		).toEqual([]);
	});

	it("holds an unbudgeted call to the page and the 1,500 ms limits only", () => {
		expect(CALL_BUDGET_MS.period_series).toBeUndefined();
		expect(overBudgetCalls([timed("period_series", 599)], "default")).toEqual(
			[],
		);
		expect(overBudgetCalls([timed("period_series", 1_500)], "default")).toEqual(
			["period_series", PAGE_OVER_BUDGET],
		);
	});

	it("names each planned function that was never timed", () => {
		expect(
			missingFunctions(
				["promotion_summary", "promotion_lift", "promotion_lift"],
				[timed("promotion_summary", 10)],
			),
		).toEqual(["promotion_lift"]);
		expect(missingFunctions([], [timed("promotion_summary", 10)])).toEqual([]);
	});

	it("checks the year to date, or the whole last year on 1 January", () => {
		expect(promotionYear("2026-11-16")).toEqual({
			from: "2026-01-01",
			to: "2026-11-16",
		});
		expect(promotionYear("2026-01-02")).toEqual({
			from: "2026-01-01",
			to: "2026-01-02",
		});
		expect(promotionYear("2027-01-01")).toEqual({
			from: "2026-01-01",
			to: "2026-12-31",
		});
	});
});

describe("the identities of the 10b live checks", () => {
	const summary = [
		summaryRow({ promotion_kind: "item", promotion_key: "P1", lines: 12 }),
		summaryRow({ promotion_kind: "bill", promotion_key: "unnamed" }),
		summaryRow({ promotion_kind: "voucher", promotion_key: "V1", invoices: 4 }),
	];
	const compliance = [
		complianceRow({
			promotion_kind: "item",
			promotion_key: "P1",
			checked_rows: 12,
			full_discount_amount: 60_000,
			over_cap_discount_amount: 40_000,
		}),
		complianceRow({
			promotion_kind: "bill",
			promotion_key: "unnamed",
			checked_rows: 10,
		}),
		complianceRow({
			promotion_kind: "voucher",
			promotion_key: "V1",
			checked_rows: 4,
		}),
		complianceRow({
			promotion_kind: "invoice_total",
			promotion_key: "all",
			checked_rows: 14,
		}),
	];

	it("holds when compliance checks every line of an item promotion and every invoice of the others", () => {
		expect(promotionIdentities(summary, compliance)).toEqual({
			promotions: 3,
			keysAgree: true,
			checkedRowsAgree: true,
			flaggedWithinDiscount: true,
		});
	});

	it("fails when an item promotion is checked per invoice instead of per line", () => {
		const perInvoice = compliance.map((row) =>
			row.promotion_kind === "item" ? { ...row, checked_rows: 10 } : row,
		);
		expect(promotionIdentities(summary, perInvoice).checkedRowsAgree).toBe(
			false,
		);
	});

	it("fails when the over-cap and full discounts exceed the promotion's discount", () => {
		const over = compliance.map((row) =>
			row.promotion_kind === "item"
				? { ...row, over_cap_discount_amount: 40_001 }
				: row,
		);
		expect(promotionIdentities(summary, over).flaggedWithinDiscount).toBe(
			false,
		);
	});

	it("fails when a promotion is missing on either side", () => {
		expect(promotionIdentities(summary, compliance.slice(1)).keysAgree).toBe(
			false,
		);
		const extra = promotionIdentities(summary.slice(1), compliance);
		expect(extra.keysAgree).toBe(false);
		expect(extra.checkedRowsAgree).toBe(false);
	});

	it("counts the discount-day items that had no discount of any kind", () => {
		expect(
			itemsWithoutDiscount([
				discountDaysRow({
					price_discount_days: 2,
					line_price_discount_days: 2,
				}),
				discountDaysRow({ gift_days: 1 }),
				discountDaysRow({ voucher_days: 3 }),
				discountDaysRow({}),
			]),
		).toBe(1);
	});

	it("compares the flagged shift ids of shift_review with cash_variance_flags", () => {
		const review = [
			{ shift_id: "shift-1", flagged: true },
			{ shift_id: "shift-2", flagged: false },
			{ shift_id: "shift-3", flagged: true },
		];
		expect(
			flaggedShifts(review, [{ shift_id: "shift-3" }, { shift_id: "shift-1" }]),
		).toEqual({ reviewFlagged: 2, cashFlagged: 2, agree: true });
		expect(
			flaggedShifts(review, [{ shift_id: "shift-1" }, { shift_id: "shift-2" }])
				.agree,
		).toBe(false);
		expect(flaggedShifts(review, [{ shift_id: "shift-1" }]).agree).toBe(false);
	});

	it("fails when a promotion key comes twice on either side", () => {
		expect(
			promotionIdentities(
				[...summary, summary[0] as PromotionSummaryRow],
				compliance,
			).keysAgree,
		).toBe(false);
		expect(
			promotionIdentities(summary, [
				...compliance,
				compliance[1] as ComplianceRow,
			]).keysAgree,
		).toBe(false);
	});

	it("fails when cash_variance_flags or shift_review lists a flagged shift twice", () => {
		const review = [
			{ shift_id: "shift-1", flagged: true },
			{ shift_id: "shift-3", flagged: true },
		];
		const twiceInCash = flaggedShifts(review, [
			{ shift_id: "shift-1" },
			{ shift_id: "shift-1" },
			{ shift_id: "shift-3" },
		]);
		expect(twiceInCash.cashFlagged).toBe(3);
		expect(twiceInCash.agree).toBe(false);
		const twiceInReview = flaggedShifts(
			[...review, { shift_id: "shift-3", flagged: true }],
			[{ shift_id: "shift-1" }, { shift_id: "shift-3" }],
		);
		expect(twiceInReview.reviewFlagged).toBe(3);
		expect(twiceInReview.agree).toBe(false);
	});

	it("reads catalogue modifier lines per store and catalogue modifiers among the items", () => {
		expect(
			catalogueModifierFacts(
				[
					qualitySummaryRow(null, 0),
					qualitySummaryRow(STORE_A, 0),
					qualitySummaryRow(STORE_B, 0),
				],
				[qualityItemRow(false), qualityItemRow(false)],
			),
		).toEqual({
			summaryRows: 3,
			catalogueModifierLines: 0,
			linesAllZero: true,
			qualityItems: 2,
			catalogueModifierItems: 0,
		});
		const sold = catalogueModifierFacts(
			[
				qualitySummaryRow(null, 2),
				qualitySummaryRow(STORE_A, 2),
				qualitySummaryRow(STORE_B, 0),
			],
			[qualityItemRow(true), qualityItemRow(false)],
		);
		expect(sold.catalogueModifierLines).toBe(2);
		expect(sold.linesAllZero).toBe(false);
		expect(sold.catalogueModifierItems).toBe(1);
	});
});
