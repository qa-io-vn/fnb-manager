import type { MetricDefinition } from "../vocabulary.js";

export const menuMetrics = [
	{
		id: "item_velocity",
		group: "menu",
		label: {
			vi: "Tốc độ bán món",
			en: "Item velocity",
		},
		unit: "% change",
		formula:
			"(quantity in the trailing 28 days − quantity in the 28 days before) ÷ the earlier quantity",
		grains: ["item-period"],
		direction: "higher",
		source: "`item_velocity()`",
		reports: ["menu", "week"],
		reportNotes: {
			week: "risers and fallers",
		},
		status: "available now",
	},
	{
		id: "menu_class",
		group: "menu",
		label: {
			vi: "Phân loại thực đơn",
			en: "Menu class (Kasavana–Smith)",
		},
		unit: "class",
		formula:
			"per item-type role over the 28 days ending `as_of_date`, across the requested stores: popular when menu mix ≥ 0.7 × (1 ÷ items in the role); high margin when the margin axis ≥ the quantity-weighted mean margin axis of the role; star (popular, high), plowhorse (popular, low), puzzle (not popular, high), dog. The axis is decided per role: contribution margin (average price − unit cost) when every item of the role has a cost, otherwise the average price for every item of the role and for its threshold, so costed and uncosted items never share one axis",
		grains: ["item-period"],
		grainNote: "28 days",
		direction: "neutral",
		source:
			"`menu_matrix()`; `menu_engineering()` for the thematic reports (tenant thresholds, effective categories, costs by business date)",
		reports: ["menu"],
		status: "needs costs",
		statusNote:
			"(a role with any item lacking a cost is `provisional = true` and ranked on price); a role with fewer than 10 sold items carries `low_sample = true` and is shown with a low-sample badge, because the thresholds are unstable below about 10 items",
	},
	{
		id: "gross_margin_rate",
		group: "menu",
		label: {
			vi: "Biên lợi nhuận gộp món",
			en: "Item gross margin rate",
		},
		unit: "fraction",
		formula:
			"(net of the costed store-days − their cost) ÷ net of the costed store-days, each store-day costed on its business date",
		grains: ["store-period", "item-period"],
		direction: "higher",
		source: "`item_margins()` (`margin_rate`)",
		reports: ["menu"],
		status: "needs costs",
	},
	{
		id: "cost_coverage",
		group: "menu",
		label: {
			vi: "Tỷ trọng doanh thu món có giá vốn",
			en: "Costed share of item revenue",
		},
		unit: "fraction",
		formula:
			"net of the item store-days with a cost on their business date ÷ item net",
		grains: ["store-period"],
		direction: "higher",
		source: "`item_margins()` (`cost_coverage`)",
		reports: ["menu", "data_quality"],
		status: "available now",
	},
] as const satisfies readonly MetricDefinition[];
