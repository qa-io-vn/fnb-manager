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

export function cardInput(
	context: ThemeContext,
	calls: Readonly<Record<string, readonly unknown[]>>,
): ThemeCardInput {
	return {
		context,
		coverage: coverageModel([], context),
		results: {
			rows<N extends ReportFunctionName>(key: string, _name: N) {
				return calls[key] as readonly ReportRow<N>[] | undefined;
			},
		},
	};
}
