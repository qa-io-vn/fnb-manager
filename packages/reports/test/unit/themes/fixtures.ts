import type { IsoDate } from "../../../src/contract/values.js";
import type { ThemeContext } from "../../../src/themes/context.js";
import type { ThemeRow } from "../../../src/themes/contract.js";
import { type NamedPreset, rangeOfPreset } from "../../../src/themes/range.js";
import { STORE_A, STORE_B } from "../fixtures.js";

export const THEME_AS_OF = "2026-11-06";

export function themeContext(
	preset: NamedPreset = "28d",
	storeIds: readonly string[] = [STORE_A, STORE_B],
	options: {
		sample?: boolean;
		asOf?: IsoDate;
		params?: Record<string, string>;
	} = {},
): ThemeContext {
	return {
		tenantId: "33333333-3333-4333-8333-333333333333",
		stores: storeIds.map((id, index) => ({
			id,
			name: `Store ${index + 1}`,
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 0,
		})),
		allStoresSelected: storeIds.length > 1,
		range: rangeOfPreset(preset, options.asOf ?? THEME_AS_OF),
		sample: options.sample ?? false,
		params: options.params ?? {},
		catchUpPending: null,
	};
}

export function rangeTotalsRow(
	rangeIndex: number,
	storeId: string | null,
	from: IsoDate,
	to: IsoDate,
	values: Partial<ThemeRow<"range_totals">> = {},
): ThemeRow<"range_totals"> {
	return {
		range_index: rangeIndex,
		store_id: storeId,
		from_date: from,
		to_date: to,
		days_with_data: 28,
		invoices: 2800,
		net_amount: 140_000_000,
		gross_amount: 145_000_000,
		item_discount_amount: 2_000_000,
		bill_discount_amount: 1_500_000,
		voucher_amount: 1_500_000,
		discount_amount: 5_000_000,
		paid_amount: 140_000_000,
		cash_amount: 28_000_000,
		items_sold: 4200,
		voucher_invoices: 280,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 0,
		voided_amount: 0,
		edited_invoices: 0,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0.1,
		member_share: 0,
		identified_share: 0,
		discount_rate: 0.034483,
		...values,
	};
}

export { STORE_A, STORE_B };
