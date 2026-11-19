import { z } from "zod";
import { periodTotalsShape } from "../contract/rows.js";
import {
	countValue,
	holidayKinds,
	isoDateArgument,
	isoDateValue,
	itemTypeRoles,
	numericValue,
	optionalCountValue,
	optionalIsoDateValue,
	optionalTextValue,
	optionalTimestampValue,
	paymentKinds,
	promotionKinds,
	requiredNumericValue,
	storeIdsArgument,
	storeIdValue,
	textListValue,
	textValue,
	timestampValue,
} from "../contract/values.js";

export const MAX_RANGES = 6;
export const HOUR_SCOPES = ["all", "weekdays", "weekend", "weekday"] as const;
export const HOUR_LEVELS = ["peak", "dead", "busy", "quiet", "normal"] as const;
export const MENU_CLASSES = ["star", "plowhorse", "puzzle", "dog"] as const;
export const CATEGORY_SOURCES = ["override", "pos", "none"] as const;

export const PROMOTION_COMPARATORS = [
	"baseline",
	"prior_weeks",
	"sister_store",
] as const;
export const COMPLIANCE_KINDS = [...promotionKinds, "invoice_total"] as const;
export const E_INVOICE_STATUSES = [
	"unknown",
	"not_configured",
	"configured",
	"disabled",
] as const;
export const TRAN_NO_RESET_PERIODS = [
	"daily",
	"yearly",
	"never",
	"unknown",
] as const;
export const POS_FEATURE_STATUSES = ["unknown", "enabled", "disabled"] as const;
export const PRE_WEEKS_LIMITS = { min: 2, max: 8 } as const;
export const DISCOUNT_DAYS_FIRST_YEAR = 2023;

export type HourScope = (typeof HOUR_SCOPES)[number];
export type HourLevel = (typeof HOUR_LEVELS)[number];
export type MenuClass = (typeof MENU_CLASSES)[number];
export type CategorySource = (typeof CATEGORY_SOURCES)[number];
export type PromotionComparator = (typeof PROMOTION_COMPARATORS)[number];
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];
export type EInvoiceStatus = (typeof E_INVOICE_STATUSES)[number];
export type TranNoResetPeriod = (typeof TRAN_NO_RESET_PERIODS)[number];
export type PosFeatureStatus = (typeof POS_FEATURE_STATUSES)[number];

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
	cost_amount: numericValue,
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

export const promotionDaysArgs = z
	.object({
		...storeRange,
		kind_filter: z.enum(promotionKinds).nullable().optional(),
		key_filter: z.string().min(1).nullable().optional(),
	})
	.refine(
		(args) =>
			args.key_filter === undefined ||
			args.key_filter === null ||
			(args.kind_filter !== undefined && args.kind_filter !== null),
		{ message: "key_filter needs a kind_filter" },
	);

export const promotionDaysRow = z.object({
	store_id: storeIdValue,
	business_date: isoDateValue,
	promotion_kind: z.enum(promotionKinds),
	promotion_key: textValue,
	promotion_name: textValue,
	invoices: countValue,
	lines: optionalCountValue,
	discount_amount: requiredNumericValue,
});

export const promotionCatalogueArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
});

export const promotionCatalogueRow = z.object({
	promotion_kind: z.enum(promotionKinds),
	promotion_key: textValue,
	promotion_name: textValue,
	in_catalogue: z.boolean(),
	catalogue_active: z.boolean().nullable(),
	starts_at: optionalTimestampValue,
	ends_at: optionalTimestampValue,
	first_used_on: optionalIsoDateValue,
	last_used_on: optionalIsoDateValue,
	days_used_365: optionalCountValue,
	invoices_365: optionalCountValue,
	discount_365: numericValue,
});

export const promotionLiftArgs = z.object({
	store_ids: storeIdsArgument,
	promotion_kind: z.enum(promotionKinds),
	promotion_key: z.string().min(1),
	from_date: isoDateArgument,
	to_date: isoDateArgument,
	comparator: z.enum(PROMOTION_COMPARATORS),
	pre_weeks: z
		.number()
		.int()
		.min(PRE_WEEKS_LIMITS.min)
		.max(PRE_WEEKS_LIMITS.max)
		.nullable()
		.optional(),
});

export const promotionLiftRow = z.object({
	business_date: optionalIsoDateValue,
	promo_day: z.boolean().nullable(),
	control_day: z.boolean().nullable(),
	test_gross_amount: numericValue,
	test_net_amount: numericValue,
	test_invoices: optionalCountValue,
	discount_amount: numericValue,
	reference_gross_amount: numericValue,
	reference_days: optionalCountValue,
	counterfactual_gross_amount: numericValue,
	gross_lift_amount: numericValue,
	test_store_count: optionalCountValue,
	control_store_count: optionalCountValue,
	promo_days: optionalCountValue,
	measured_days: optionalCountValue,
	control_days: optionalCountValue,
	trend_adjustment_amount: numericValue,
	net_lift_amount: numericValue,
	lift_rate: numericValue,
	flags: textListValue,
});

export const promotionComplianceArgs = z.object({
	...storeRange,
	cap_rate: z.number().gt(0).max(1).optional(),
});

export const promotionComplianceRow = z.object({
	promotion_kind: z.enum(COMPLIANCE_KINDS),
	promotion_key: textValue,
	promotion_name: optionalTextValue,
	checked_rows: countValue,
	max_partial_rate: numericValue,
	over_cap_rows: countValue,
	over_cap_discount_amount: numericValue,
	first_over_cap_on: optionalIsoDateValue,
	last_over_cap_on: optionalIsoDateValue,
	full_discount_rows: countValue,
	full_discount_amount: numericValue,
	first_full_discount_on: optionalIsoDateValue,
	last_full_discount_on: optionalIsoDateValue,
});

export const itemDiscountDaysArgs = z.object({
	store_ids: storeIdsArgument,
	calendar_year: z.number().int().min(DISCOUNT_DAYS_FIRST_YEAR),
	as_of_date: isoDateArgument.nullable().optional(),
});

export const itemDiscountDaysRow = z.object({
	item_external_id: textValue,
	item_name: optionalTextValue,
	price_discount_days: countValue,
	line_price_discount_days: countValue,
	bill_discount_days: countValue,
	gift_days: countValue,
	voucher_days: countValue,
	first_price_discount_on: optionalIsoDateValue,
	last_price_discount_on: optionalIsoDateValue,
});

export const shiftAdjustmentsArgs = z.object({
	...storeRange,
	z_threshold: z.number().positive().nullable().optional(),
});

export const shiftAdjustmentsRow = z.object({
	store_id: storeIdValue,
	shift_id: textValue,
	shift_external_id: textValue,
	shift_name: optionalTextValue,
	business_date: isoDateValue,
	cashier_name: optionalTextValue,
	opened_at: timestampValue,
	closed_at: optionalTimestampValue,
	orders: countValue,
	item_lines: countValue,
	voids: countValue,
	void_amount: numericValue,
	edits: countValue,
	removed_lines: countValue,
	removed_amount: numericValue,
	edits_after_close: countValue,
	changed_after_close: z.boolean(),
	void_rate: numericValue,
	removed_line_rate: numericValue,
	trailing_shifts: countValue,
	void_z_score: numericValue,
	removed_z_score: numericValue,
	flagged: z.boolean(),
	reasons: textListValue,
});

export const dataQualityItemsArgs = z.object(storeRange);

export const dataQualityItemsRow = z.object({
	item_external_id: textValue,
	item_name: optionalTextValue,
	pos_account_id: optionalTextValue,
	pos_type_external_id: optionalTextValue,
	pos_type_name: optionalTextValue,
	override_type_external_id: optionalTextValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	type_known: z.boolean(),
	role: z.enum(itemTypeRoles).nullable(),
	cost_known: z.boolean(),
	catalogue_modifier: z.boolean(),
	quantity: requiredNumericValue,
	net_amount: requiredNumericValue,
	net_share: numericValue,
});

export const dataQualitySummaryArgs = z.object(storeRange);

export const dataQualitySummaryRow = z.object({
	store_id: storeIdValue,
	invoices: countValue,
	item_lines: countValue,
	modifier_lines: countValue,
	modifier_line_share: numericValue,
	catalogue_modifier_lines: countValue,
	identified_invoices: countValue,
	capture_rate: numericValue,
	identified_customers: countValue,
	loyalty_consents: countValue,
	marketing_consents: countValue,
	consent_coverage: numericValue,
	unattributed_events: countValue,
	e_invoice_status: z.enum(E_INVOICE_STATUSES).nullable(),
	tran_no_reset_period: z.enum(TRAN_NO_RESET_PERIODS).nullable(),
	member_capture_status: z.enum(POS_FEATURE_STATUSES).nullable(),
	opening_hours_known: z.boolean().nullable(),
	seat_count: optionalCountValue,
	opened_on: optionalIsoDateValue,
	receipt_days: optionalCountValue,
	receipt_restarts_daily: z.boolean().nullable(),
});

export const dataQualityPaymentsArgs = z.object(storeRange);

export const dataQualityPaymentsRow = z.object({
	pos_account_id: optionalTextValue,
	payment_method_external_id: textValue,
	payment_method_name: optionalTextValue,
	kind: z.enum(paymentKinds),
	pos_kind: z.enum(paymentKinds).nullable(),
	override_kind: z.enum(paymentKinds).nullable(),
	in_catalogue: z.boolean(),
	invoices: optionalCountValue,
	amount: numericValue,
});

export const METRIC_WINDOW_LIMITS = {
	metricIds: 25,
	ranges: 12,
	days: 400,
} as const;
export const HOLIDAY_CALENDAR_MAX_DAYS = 400;

export const storeProfilesArgs = z.object({ store_ids: storeIdsArgument });

export const storeProfilesRow = z.object({
	store_id: textValue,
	tenant_id: textValue,
	label: z.string().regex(/^S\d+$/),
	name: textValue,
	timezone: textValue,
	business_day_start_minutes: countValue,
	opened_on: optionalIsoDateValue,
	opening_hours: z
		.record(z.string(), z.array(z.tuple([z.string(), z.string()])))
		.nullable(),
	seat_count: optionalCountValue,
	e_invoice_status: z.enum(E_INVOICE_STATUSES),
	currency_code: textValue,
	country_code: textValue,
});

export const metricWindowsArgs = z.object({
	store_ids: storeIdsArgument,
	metric_ids: z
		.array(z.string().min(1))
		.min(1)
		.max(METRIC_WINDOW_LIMITS.metricIds),
	from_dates: z.array(isoDateArgument).min(1).max(METRIC_WINDOW_LIMITS.ranges),
	to_dates: z.array(isoDateArgument).min(1).max(METRIC_WINDOW_LIMITS.ranges),
});

export const metricWindowsRow = z.object({
	range_index: countValue,
	from_date: isoDateValue,
	to_date: isoDateValue,
	metric_id: textValue,
	value: numericValue,
});

export const holidayCalendarArgs = z.object(storeRange);

export const holidayCalendarRow = z.object({
	holiday_date: isoDateValue,
	name: textValue,
	kind: z.enum(holidayKinds),
});

export const planKpiReviewArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
});

export const planKpiReviewRow = z.object({
	plan_rank: countValue,
	plan_as_of: isoDateValue,
	horizon: textValue,
	metric_id: textValue,
	scope: textValue,
	baseline: numericValue,
	target: numericValue,
	due_on: optionalIsoDateValue,
	current_value: numericValue,
});

export const REDEMPTION_SUMMARY_MAX_DAYS = 92;
export const COUPON_REWARD_KINDS = [
	"free_item",
	"percent_off",
	"amount_off",
	"free_upgrade",
] as const;

export type CouponRewardKind = (typeof COUPON_REWARD_KINDS)[number];

export const redemptionSummaryArgs = z.object(storeRange);

export const redemptionSummaryRow = z.object({
	store_id: storeIdValue,
	coupon_id: textValue,
	reward_key: textValue,
	coupon_name: textValue,
	reward_kind: z.enum(COUPON_REWARD_KINDS),
	redemptions: countValue,
	held: countValue,
	confirmed: countValue,
	released: countValue,
	stamps_redeemed: countValue,
	points_redeemed: countValue,
	reward_cost_amount: requiredNumericValue,
	member_invoices: countValue,
	confirmed_share: numericValue,
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
	promotion_days: { args: promotionDaysArgs, row: promotionDaysRow },
	promotion_catalogue: {
		args: promotionCatalogueArgs,
		row: promotionCatalogueRow,
	},
	promotion_lift: { args: promotionLiftArgs, row: promotionLiftRow },
	promotion_compliance: {
		args: promotionComplianceArgs,
		row: promotionComplianceRow,
	},
	item_discount_days: {
		args: itemDiscountDaysArgs,
		row: itemDiscountDaysRow,
	},
	shift_adjustments: {
		args: shiftAdjustmentsArgs,
		row: shiftAdjustmentsRow,
	},
	data_quality_items: {
		args: dataQualityItemsArgs,
		row: dataQualityItemsRow,
	},
	data_quality_summary: {
		args: dataQualitySummaryArgs,
		row: dataQualitySummaryRow,
	},
	data_quality_payments: {
		args: dataQualityPaymentsArgs,
		row: dataQualityPaymentsRow,
	},
	store_profiles: { args: storeProfilesArgs, row: storeProfilesRow },
	metric_windows: { args: metricWindowsArgs, row: metricWindowsRow },
	holiday_calendar: { args: holidayCalendarArgs, row: holidayCalendarRow },
	plan_kpi_review: { args: planKpiReviewArgs, row: planKpiReviewRow },
	redemption_summary: {
		args: redemptionSummaryArgs,
		row: redemptionSummaryRow,
	},
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
