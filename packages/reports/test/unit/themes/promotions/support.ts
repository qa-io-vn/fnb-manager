import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import type { IsoDate } from "../../../../src/contract/values.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { ThemeRow } from "../../../../src/themes/contract.js";
import { RANGE_INDEX } from "../../../../src/themes/definition.js";
import { rangeTotalsRow } from "../fixtures.js";

export { cardInput, seriesRow, settingsRow } from "../payments/support.js";

export type PromotionRow = AnalyticsRow<"promotion_summary">;
export type LiftRow = ThemeRow<"promotion_lift">;

export function promotionRow(overrides: Partial<PromotionRow>): PromotionRow {
	return {
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		invoices: 30,
		lines: 33,
		discount_amount: 1_000_000,
		first_used_on: "2026-10-10",
		last_used_on: "2026-11-02",
		days_used: 20,
		...overrides,
	};
}

export function liftDay(
	date: IsoDate,
	overrides: Partial<LiftRow> = {},
): LiftRow {
	return {
		business_date: date,
		promo_day: false,
		control_day: true,
		test_gross_amount: 5_000_000,
		test_net_amount: 4_900_000,
		test_invoices: 100,
		discount_amount: null,
		reference_gross_amount: 4_800_000,
		reference_days: 8,
		counterfactual_gross_amount: null,
		gross_lift_amount: null,
		test_store_count: null,
		control_store_count: null,
		promo_days: null,
		measured_days: null,
		control_days: null,
		trend_adjustment_amount: null,
		net_lift_amount: null,
		lift_rate: null,
		flags: null,
		...overrides,
	};
}

export function liftSummaryRow(overrides: Partial<LiftRow> = {}): LiftRow {
	return {
		business_date: null,
		promo_day: null,
		control_day: null,
		test_gross_amount: null,
		test_net_amount: null,
		test_invoices: null,
		discount_amount: 300_000,
		reference_gross_amount: null,
		reference_days: null,
		counterfactual_gross_amount: null,
		gross_lift_amount: 1_200_000,
		test_store_count: 1,
		control_store_count: 0,
		promo_days: 3,
		measured_days: 3,
		control_days: 9,
		trend_adjustment_amount: 150_000,
		net_lift_amount: 900_000,
		lift_rate: 0.08,
		flags: [],
		...overrides,
	};
}

export function threeRanges(
	context: ThemeContext,
	values: {
		readonly current?: Partial<ThemeRow<"range_totals">>;
		readonly previous?: Partial<ThemeRow<"range_totals">>;
		readonly lastYear?: Partial<ThemeRow<"range_totals">>;
	} = {},
): ThemeRow<"range_totals">[] {
	const rows = [
		rangeTotalsRow(
			RANGE_INDEX.current,
			null,
			context.range.from,
			context.range.to,
			values.current,
		),
		rangeTotalsRow(
			RANGE_INDEX.previous,
			null,
			context.range.previous.from,
			context.range.previous.to,
			values.previous,
		),
	];
	if (context.range.lastYear !== null) {
		rows.push(
			rangeTotalsRow(
				RANGE_INDEX.last_year,
				null,
				context.range.lastYear.from,
				context.range.lastYear.to,
				values.lastYear,
			),
		);
	}
	return rows;
}
