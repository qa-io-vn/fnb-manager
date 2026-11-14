import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { ThemeRow } from "../../../../src/themes/contract.js";
import type {
	ReportRow,
	ThemeCardInput,
} from "../../../../src/themes/definition.js";
import type { ReportFunctionName } from "../../../../src/themes/source.js";

export type MenuRow = ThemeRow<"menu_engineering">;
export type MarginRow = ThemeRow<"item_margins">;
export type ItemRow = AnalyticsRow<"item_summary">;
export type AttachRow = ThemeRow<"item_attach">;
export type PairRow = ThemeRow<"basket_pairs">;
export type ModifierRow = ThemeRow<"modifier_summary">;
export type CoverageRow = AnalyticsRow<"store_coverage">;

export function menuRow(overrides: Partial<MenuRow>): MenuRow {
	return {
		role: "drink",
		role_mapped: true,
		item_external_id: "D1",
		item_name: "Trà đào",
		item_type_external_id: "T-DRINK",
		item_type_name: "Trà sữa",
		category_source: "pos",
		quantity: 100,
		net_amount: 4_000_000,
		menu_mix_pct: 50,
		popularity_threshold_pct: 35,
		avg_unit_price: 40_000,
		unit_cost: null,
		margin_axis: 40_000,
		margin_threshold: 35_000,
		provisional: true,
		low_sample: true,
		menu_class: "star",
		window_from: "2026-10-10",
		window_days_used: 28,
		popularity_factor_used: 0.7,
		low_sample_items_used: 10,
		...overrides,
	};
}

export function marginRow(overrides: Partial<MarginRow>): MarginRow {
	return {
		item_external_id: "D1",
		item_name: "Trà đào",
		base_name: "Trà đào",
		size_label: null,
		item_type_external_id: "T-DRINK",
		item_type_name: "Trà sữa",
		role: "drink",
		quantity: 100,
		net_amount: 4_000_000,
		costed_quantity: 100,
		costed_net_amount: 4_000_000,
		cost_amount: 2_500_000,
		unit_cost_latest: 25_000,
		margin_amount: 1_500_000,
		margin_rate: 0.375,
		cost_coverage: 1,
		...overrides,
	};
}

export function itemRow(overrides: Partial<ItemRow>): ItemRow {
	return {
		item_external_id: "D1",
		item_name: "Trà đào",
		base_name: "Trà đào",
		size_label: null,
		item_type_external_id: "T-DRINK",
		item_type_name: "Trà sữa",
		role: "drink",
		quantity: 100,
		net_amount: 4_000_000,
		invoices: 90,
		days_sold: 28,
		net_share: null,
		compare_quantity: 80,
		compare_net_amount: 3_200_000,
		compare_net_share: null,
		first_sold_on: "2026-01-01",
		last_sold_on: "2026-11-05",
		...overrides,
	};
}

export function attachRow(overrides: Partial<AttachRow>): AttachRow {
	return {
		item_external_id: null,
		item_name: null,
		drink_invoices: 400,
		topping_base_invoices: 400,
		topping_invoices: 100,
		snack_base_invoices: 400,
		snack_invoices: 40,
		topping_rate: 0.25,
		snack_rate: 0.1,
		...overrides,
	};
}

export function pairRow(overrides: Partial<PairRow>): PairRow {
	return {
		item_a_external_id: "D1",
		item_a_name: "Trà đào",
		item_b_external_id: "T1",
		item_b_name: "Trân châu",
		pair_invoices: 12,
		invoices_a: 60,
		invoices_b: 40,
		window_invoices: 500,
		support_a: 0.12,
		support_b: 0.08,
		confidence_a_to_b: 0.2,
		confidence_b_to_a: 0.3,
		lift: 2.5,
		...overrides,
	};
}

export function modifierRow(overrides: Partial<ModifierRow>): ModifierRow {
	return {
		modifier_name: "50% Đường",
		lines: 10,
		share: null,
		compare_lines: 10,
		compare_share: null,
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
