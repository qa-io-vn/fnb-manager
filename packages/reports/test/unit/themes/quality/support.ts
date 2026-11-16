import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { ThemeRow } from "../../../../src/themes/contract.js";
import type {
	ReportRow,
	ThemeCardInput,
} from "../../../../src/themes/definition.js";
import type { ReportFunctionName } from "../../../../src/themes/source.js";

export type ItemRow = ThemeRow<"data_quality_items">;
export type SummaryRow = ThemeRow<"data_quality_summary">;
export type PaymentRow = ThemeRow<"data_quality_payments">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type CoverageRow = AnalyticsRow<"store_coverage">;
export type MarginRow = ThemeRow<"item_margins">;

export const ACCOUNT = "44444444-4444-4444-8444-444444444444";

export function itemRow(overrides: Partial<ItemRow>): ItemRow {
	return {
		item_external_id: "ITEM-1",
		item_name: "Món một",
		pos_account_id: ACCOUNT,
		pos_type_external_id: "TYPE-1",
		pos_type_name: "Nhóm một",
		override_type_external_id: null,
		item_type_external_id: "TYPE-1",
		item_type_name: "Nhóm một",
		type_known: true,
		role: "drink",
		cost_known: true,
		catalogue_modifier: false,
		quantity: 10,
		net_amount: 1_000_000,
		net_share: null,
		...overrides,
	};
}

export function marginRow(overrides: Partial<MarginRow>): MarginRow {
	return {
		item_external_id: "ITEM-1",
		item_name: "Món một",
		base_name: "Món một",
		size_label: null,
		item_type_external_id: "TYPE-1",
		item_type_name: "Nhóm một",
		role: "drink",
		quantity: 10,
		net_amount: 1_000_000,
		costed_quantity: 10,
		costed_net_amount: 1_000_000,
		cost_amount: 400_000,
		unit_cost_latest: 40_000,
		margin_amount: 600_000,
		margin_rate: 0.6,
		cost_coverage: 1,
		...overrides,
	};
}

export function summaryRow(
	storeId: string | null,
	overrides: Partial<SummaryRow> = {},
): SummaryRow {
	return {
		store_id: storeId,
		invoices: 100,
		item_lines: 150,
		modifier_lines: 50,
		modifier_line_share: 0.25,
		catalogue_modifier_lines: 0,
		identified_invoices: 20,
		capture_rate: 0.2,
		identified_customers: 10,
		loyalty_consents: 4,
		marketing_consents: 2,
		consent_coverage: 0.4,
		unattributed_events: 0,
		e_invoice_status: storeId === null ? null : "configured",
		tran_no_reset_period: storeId === null ? null : "daily",
		member_capture_status: storeId === null ? null : "enabled",
		opening_hours_known: storeId === null ? null : true,
		seat_count: storeId === null ? null : 30,
		opened_on: storeId === null ? null : "2024-01-15",
		receipt_days: null,
		receipt_restarts_daily: null,
		...overrides,
	};
}

export function paymentRow(overrides: Partial<PaymentRow>): PaymentRow {
	return {
		pos_account_id: ACCOUNT,
		payment_method_external_id: "CASH",
		payment_method_name: "Tiền mặt",
		kind: "cash",
		pos_kind: "cash",
		override_kind: null,
		in_catalogue: true,
		invoices: 50,
		amount: 2_500_000,
		...overrides,
	};
}

export function dayRow(
	storeId: string | null,
	bucket: string,
	overrides: Partial<SeriesRow> = {},
): SeriesRow {
	return {
		store_id: storeId,
		bucket_start: bucket,
		bucket_end: bucket,
		iso_year: null,
		iso_week: null,
		weekday: null,
		calendar_days: 1,
		excluded_days: 0,
		tet_days: 0,
		holiday_kind: null,
		checked_days: 1,
		matched_days: 1,
		days_with_data: 1,
		invoices: 100,
		net_amount: 5_000_000,
		gross_amount: 5_200_000,
		item_discount_amount: 0,
		bill_discount_amount: 0,
		voucher_amount: 0,
		discount_amount: 200_000,
		paid_amount: 5_000_000,
		cash_amount: 1_000_000,
		items_sold: 150,
		voucher_invoices: 0,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 0,
		voided_amount: 0,
		edited_invoices: 0,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0,
		member_share: 0,
		identified_share: 0,
		discount_rate: 0.04,
		...overrides,
	};
}

export function cardInput(
	context: ThemeContext,
	calls: Readonly<Record<string, readonly unknown[]>>,
	coverageRows: readonly CoverageRow[] = [],
): ThemeCardInput {
	return {
		context,
		coverage: coverageModel(coverageRows, context),
		results: {
			rows<N extends ReportFunctionName>(key: string, _name: N) {
				return calls[key] as readonly ReportRow<N>[] | undefined;
			},
		},
	};
}
