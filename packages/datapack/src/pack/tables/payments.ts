import { type AnalyticsRow, difference } from "@fnb/reports";
import { CALL_KEYS, scopedKey } from "../calls.js";
import type { PackScope } from "../coverage.js";
import type { PackTable } from "../schema.js";
import {
	byNumberDescending,
	byText,
	columns,
	type PackRows,
	packRow,
	packTable,
	rankKey,
	type TableContext,
	type TableSpec,
} from "./support.js";

type PaymentRow = AnalyticsRow<"payment_summary">;
type PromotionRow = AnalyticsRow<"promotion_summary">;

export const PAYMENT_LIMIT = 8;
export const PROMOTION_LIMIT = 8;

export const PAYMENTS_SPEC: TableSpec = {
	grain: "method-period",
	window: "w28",
	columns: columns([
		["name", "text"],
		["kind", "class"],
		["invoices", "count"],
		["amount", "money"],
		["share", "fraction"],
		["share_change", "pp_change"],
		["fee", "money"],
	]),
};

export const PROMOTIONS_SPEC: TableSpec = {
	grain: "promotion-period",
	window: "w28",
	columns: columns([
		["name", "text"],
		["kind", "class"],
		["invoices", "count"],
		["discount", "money"],
		["days", "days"],
	]),
};

export function byPaymentOrder(left: PaymentRow, right: PaymentRow): number {
	return (
		byNumberDescending(left.amount, right.amount) ||
		byNumberDescending(left.invoices, right.invoices) ||
		byText(left.kind, right.kind) ||
		byText(left.payment_method_name, right.payment_method_name) ||
		byText(left.method_key, right.method_key)
	);
}

export function byPromotionOrder(
	left: PromotionRow,
	right: PromotionRow,
): number {
	return (
		byNumberDescending(left.discount_amount, right.discount_amount) ||
		byNumberDescending(left.invoices, right.invoices) ||
		byText(left.promotion_kind, right.promotion_kind) ||
		byText(left.promotion_name, right.promotion_name) ||
		byText(left.promotion_key, right.promotion_key)
	);
}

function feeRatesKnown(context: TableContext, scope: PackScope): boolean {
	const settings = context.results.rows(
		CALL_KEYS.settings,
		"report_settings_of",
	);
	return scope.storeIds.every(
		(id) =>
			settings.find((row) => row.store_id === id)?.fee_rates_configured ===
			true,
	);
}

export function paymentsTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const feesKnown = feeRatesKnown(context, scope);
		const kept = [
			...context.results.rows(scopedKey("payments", scope), "payment_summary"),
		]
			.filter((row) => row.amount !== 0 || row.invoices > 0)
			.sort(byPaymentOrder)
			.slice(0, PAYMENT_LIMIT);
		kept.forEach((payment, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				PAYMENTS_SPEC,
				[
					payment.payment_method_name,
					payment.kind,
					payment.invoices,
					payment.amount,
					payment.share,
					difference(payment.share, payment.compare_share),
					feesKnown ? payment.fee_estimate_amount : null,
				],
				context.request.currency,
			);
		});
	}
	return packTable("payments", context, PAYMENTS_SPEC, rows);
}

export function promotionsTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const kept = [
			...context.results.rows(
				scopedKey("promotions", scope),
				"promotion_summary",
			),
		]
			.sort(byPromotionOrder)
			.slice(0, PROMOTION_LIMIT);
		kept.forEach((promotion, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				PROMOTIONS_SPEC,
				[
					promotion.promotion_name,
					promotion.promotion_kind,
					promotion.invoices,
					promotion.discount_amount,
					promotion.days_used,
				],
				context.request.currency,
			);
		});
	}
	return packTable("promotions", context, PROMOTIONS_SPEC, rows);
}
