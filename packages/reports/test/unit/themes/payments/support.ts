import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type {
	ReportRow,
	ThemeCardInput,
} from "../../../../src/themes/definition.js";
import type { ReportFunctionName } from "../../../../src/themes/source.js";

export type PaymentRow = AnalyticsRow<"payment_summary">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type CoverageRow = AnalyticsRow<"store_coverage">;

export function paymentRow(overrides: Partial<PaymentRow>): PaymentRow {
	return {
		method_key: "CASH",
		kind: "cash",
		payment_method_name: "Tiền mặt",
		invoices: 100,
		amount: 2_000_000,
		share: 0.2,
		fee_amount: 0,
		fee_estimate_amount: 0,
		compare_amount: 2_500_000,
		compare_share: 0.25,
		...overrides,
	};
}

export function seriesRow(
	bucket: string,
	overrides: Partial<SeriesRow> = {},
): SeriesRow {
	return {
		store_id: null,
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
