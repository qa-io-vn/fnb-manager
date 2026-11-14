import { z } from "zod";
import { periodTotalsShape } from "../contract/rows.js";
import {
	countValue,
	isoDateArgument,
	isoDateValue,
	itemTypeRoles,
	numericValue,
	optionalCountValue,
	optionalTextValue,
	requiredNumericValue,
	storeIdsArgument,
	storeIdValue,
	textValue,
} from "../contract/values.js";

export const MAX_RANGES = 6;
export const HOUR_SCOPES = ["all", "weekdays", "weekend", "weekday"] as const;
export const HOUR_LEVELS = ["peak", "dead", "busy", "quiet", "normal"] as const;
export const MENU_CLASSES = ["star", "plowhorse", "puzzle", "dog"] as const;
export const CATEGORY_SOURCES = ["override", "pos", "none"] as const;

export type HourScope = (typeof HOUR_SCOPES)[number];
export type HourLevel = (typeof HOUR_LEVELS)[number];
export type MenuClass = (typeof MENU_CLASSES)[number];
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

const storeRange = {
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
};

const optionalThreshold = requiredNumericValue.nullable().optional();
const optionalInteger = z.number().int().nullable().optional();

export const reportSettingsOfArgs = z.object({ store_ids: storeIdsArgument });

export const storeReportSettingsShape = {
	store_id: storeIdValue,
	tenant_id: z.string(),
	has_tenant_row: z.boolean(),
	menu_window_days: countValue,
	menu_popularity_factor: requiredNumericValue,
	menu_low_sample_items: countValue,
	cash_abs_threshold: requiredNumericValue,
	cash_rel_threshold: requiredNumericValue,
	z_threshold: requiredNumericValue,
	peak_hours: countValue,
	dead_hour_ratio: requiredNumericValue,
	busy_hour_ratio: requiredNumericValue,
	promo_pre_weeks: countValue,
} as const;

export const reportSettingsOfRow = z.object({
	...storeReportSettingsShape,
	seat_count: optionalCountValue,
	opening_hours_known: z.boolean(),
	fee_rates_configured: z.boolean(),
	costs_configured: z.boolean(),
	roles_configured: z.boolean(),
});

export const rangeTotalsArgs = z
	.object({
		store_ids: storeIdsArgument,
		from_dates: z.array(isoDateArgument).min(1).max(MAX_RANGES),
		to_dates: z.array(isoDateArgument).min(1).max(MAX_RANGES),
	})
	.refine((args) => args.from_dates.length === args.to_dates.length, {
		message: "from_dates and to_dates need the same length",
	});

export const rangeTotalsRow = z.object({
	range_index: countValue,
	store_id: storeIdValue,
	from_date: isoDateValue,
	to_date: isoDateValue,
	...periodTotalsShape,
});

export const openingProductivityArgs = z.object(storeRange);

export const openingProductivityRow = z.object({
	store_id: storeIdValue,
	days_with_sales: countValue,
	invoices: optionalCountValue,
	net_amount: numericValue,
	opening_minutes: optionalCountValue,
	seat_count: optionalCountValue,
	seat_minutes: optionalCountValue,
	sales_per_opening_hour: numericValue,
	invoices_per_opening_hour: numericValue,
	revpash: numericValue,
});

export const hourWeekdayHeatmapArgs = z.object(storeRange);

export const hourWeekdayHeatmapRow = z.object({
	weekday: countValue,
	hour_local: countValue,
	days_with_data: countValue,
	invoices: countValue,
	net_amount: requiredNumericValue,
	avg_net_amount: numericValue,
	avg_invoices: numericValue,
});

export const hourProfileArgs = z.object({
	...storeRange,
	peak_hours: optionalInteger,
	dead_hour_ratio: optionalThreshold,
	busy_hour_ratio: optionalThreshold,
});

export const hourProfileRow = z.object({
	scope: z.enum(HOUR_SCOPES),
	weekday: optionalCountValue,
	hour_local: optionalCountValue,
	hour_position: optionalCountValue,
	days_with_data: countValue,
	invoices: countValue,
	net_amount: requiredNumericValue,
	avg_net_amount: numericValue,
	avg_invoices: numericValue,
	net_share: numericValue,
	level: z.enum(HOUR_LEVELS).nullable(),
	peak_share: numericValue,
	dead_share: numericValue,
	peak_hours_used: countValue,
	dead_hour_ratio_used: requiredNumericValue,
	busy_hour_ratio_used: requiredNumericValue,
});

export const menuEngineeringArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
	window_days: optionalInteger,
	popularity_factor: optionalThreshold,
	low_sample_items: optionalInteger,
});

export const menuEngineeringRow = z.object({
	role: z.enum(itemTypeRoles),
	role_mapped: z.boolean(),
	item_external_id: textValue,
	item_name: optionalTextValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	category_source: z.enum(CATEGORY_SOURCES),
	quantity: requiredNumericValue,
	net_amount: requiredNumericValue,
	menu_mix_pct: numericValue,
	popularity_threshold_pct: numericValue,
	avg_unit_price: numericValue,
	unit_cost: numericValue,
	margin_axis: numericValue,
	margin_threshold: numericValue,
	provisional: z.boolean(),
	low_sample: z.boolean(),
	menu_class: z.enum(MENU_CLASSES).nullable(),
	window_from: isoDateValue,
	window_days_used: countValue,
	popularity_factor_used: requiredNumericValue,
	low_sample_items_used: countValue,
});

export const itemMarginsArgs = z.object(storeRange);

export const itemMarginsRow = z.object({
	item_external_id: textValue,
	item_name: optionalTextValue,
	base_name: optionalTextValue,
	size_label: optionalTextValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	role: z.enum(itemTypeRoles).nullable(),
	quantity: requiredNumericValue,
	net_amount: requiredNumericValue,
	costed_quantity: requiredNumericValue,
	costed_net_amount: requiredNumericValue,
	cost_amount: requiredNumericValue,
	unit_cost_latest: numericValue,
	margin_amount: numericValue,
	margin_rate: numericValue,
	cost_coverage: numericValue,
});

export const itemAttachArgs = z.object(storeRange);

export const itemAttachRow = z.object({
	item_external_id: optionalTextValue,
	item_name: optionalTextValue,
	drink_invoices: countValue,
	topping_base_invoices: countValue,
	topping_invoices: countValue,
	snack_base_invoices: countValue,
	snack_invoices: countValue,
	topping_rate: numericValue,
	snack_rate: numericValue,
});

export const basketPairsArgs = z.object({
	...storeRange,
	min_pair_invoices: z.number().int().min(1).max(50).optional(),
	max_pairs: z.number().int().min(1).max(900).optional(),
});

export const basketPairsRow = z.object({
	item_a_external_id: textValue,
	item_a_name: optionalTextValue,
	item_b_external_id: textValue,
	item_b_name: optionalTextValue,
	pair_invoices: countValue,
	invoices_a: countValue,
	invoices_b: countValue,
	window_invoices: countValue,
	support_a: numericValue,
	support_b: numericValue,
	confidence_a_to_b: numericValue,
	confidence_b_to_a: numericValue,
	lift: numericValue,
});

export const modifierSummaryArgs = z.object({
	...storeRange,
	compare_from: isoDateArgument.nullable().optional(),
	compare_to: isoDateArgument.nullable().optional(),
});

export const modifierSummaryRow = z.object({
	modifier_name: textValue,
	lines: countValue,
	share: numericValue,
	compare_lines: optionalCountValue,
	compare_share: numericValue,
});

export const themeFunctions = {
	report_settings_of: { args: reportSettingsOfArgs, row: reportSettingsOfRow },
	range_totals: { args: rangeTotalsArgs, row: rangeTotalsRow },
	opening_productivity: {
		args: openingProductivityArgs,
		row: openingProductivityRow,
	},
	hour_weekday_heatmap: {
		args: hourWeekdayHeatmapArgs,
		row: hourWeekdayHeatmapRow,
	},
	hour_profile: { args: hourProfileArgs, row: hourProfileRow },
	menu_engineering: { args: menuEngineeringArgs, row: menuEngineeringRow },
	item_margins: { args: itemMarginsArgs, row: itemMarginsRow },
	item_attach: { args: itemAttachArgs, row: itemAttachRow },
	basket_pairs: { args: basketPairsArgs, row: basketPairsRow },
	modifier_summary: { args: modifierSummaryArgs, row: modifierSummaryRow },
} as const;

export type ThemeFunctionName = keyof typeof themeFunctions;
export type ThemeArgs<N extends ThemeFunctionName> = z.input<
	(typeof themeFunctions)[N]["args"]
>;
export type ThemeRow<N extends ThemeFunctionName> = z.output<
	(typeof themeFunctions)[N]["row"]
>;

export const themeFunctionNames = Object.keys(
	themeFunctions,
) as readonly ThemeFunctionName[];

export function isThemeFunctionName(name: string): name is ThemeFunctionName {
	return Object.hasOwn(themeFunctions, name);
}

export function themeArgumentNames(name: ThemeFunctionName): readonly string[] {
	return Object.keys(themeFunctions[name].args.shape);
}

export function themeRowColumns(name: ThemeFunctionName): readonly string[] {
	return Object.keys(themeFunctions[name].row.shape);
}
