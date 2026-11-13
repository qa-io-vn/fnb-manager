import {
	type AnalyticsRow,
	type IsoDate,
	periodContaining,
	type ReportContext,
	type ReportKind,
} from "../../src/index.js";

export const STORE_A = "11111111-1111-4111-8111-111111111111";
export const STORE_B = "22222222-2222-4222-8222-222222222222";

export function context(
	kind: ReportKind,
	date: IsoDate,
	storeIds: readonly string[] = [STORE_A, STORE_B],
	options: { sample?: boolean; asOf?: IsoDate } = {},
): ReportContext {
	const asOf = options.asOf ?? "2026-11-03";
	return {
		tenantId: "33333333-3333-4333-8333-333333333333",
		stores: storeIds.map((id, index) => ({
			id,
			name: `Store ${index + 1}`,
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 0,
		})),
		allStoresSelected: storeIds.length > 1,
		period: periodContaining(kind, date, asOf),
		sample: options.sample ?? false,
	};
}

export function coverageRow(
	storeId: string,
	overrides: Partial<AnalyticsRow<"store_coverage">> = {},
): AnalyticsRow<"store_coverage"> {
	return {
		store_id: storeId,
		opened_on: null,
		first_sales_on: "2025-01-01",
		last_sales_on: "2026-11-03",
		history_start: "2025-01-01",
		store_as_of_date: "2026-11-03",
		sales_days: 1,
		checked_days: 1,
		matched_days: 1,
		unmatched_days: 0,
		unchecked_sales_days: 0,
		stale_days: 0,
		last_refreshed_at: null,
		...overrides,
	};
}

export function totalsRow(
	storeId: string | null,
	period: "current" | "previous" | "last_year" | "baseline",
	from: IsoDate,
	to: IsoDate,
	values: Partial<AnalyticsRow<"period_compare_by_store">> = {},
): AnalyticsRow<"period_compare_by_store"> {
	return {
		store_id: storeId,
		period,
		from_date: from,
		to_date: to,
		days_with_data: 1,
		invoices: 100,
		net_amount: 5_000_000,
		gross_amount: 5_200_000,
		item_discount_amount: 100_000,
		bill_discount_amount: 50_000,
		voucher_amount: 50_000,
		discount_amount: 200_000,
		paid_amount: 5_000_000,
		cash_amount: 1_000_000,
		items_sold: 150,
		voucher_invoices: 10,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 1,
		voided_amount: 40_000,
		edited_invoices: 1,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0.1,
		member_share: 0,
		identified_share: 0,
		discount_rate: 0.038462,
		...values,
	};
}

export function compareRow(
	period: "current" | "previous" | "last_year" | "baseline",
	from: IsoDate,
	to: IsoDate,
	values: Partial<AnalyticsRow<"period_compare">> = {},
): AnalyticsRow<"period_compare"> {
	return {
		period,
		from_date: from,
		to_date: to,
		days_with_data: 1,
		invoices: 60,
		net_amount: 3_000_000,
		gross_amount: 3_100_000,
		discount_amount: 100_000,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0.1,
		member_share: 0,
		identified_share: 0,
		...values,
	};
}
