import { z } from "zod";
import {
	comparePeriods,
	countValue,
	forecastIds,
	holidayKinds,
	isoDateArgument,
	isoDateValue,
	itemTypeRoles,
	metricPeriods,
	numericValue,
	optionalCountValue,
	optionalIsoDateValue,
	optionalTextValue,
	optionalTimestampValue,
	paymentKinds,
	promotionKinds,
	reportGrainArgument,
	requiredNumericValue,
	seriesGrainArgument,
	storeIdsArgument,
	storeIdValue,
	textListValue,
	textValue,
	timestampValue,
} from "./values.js";

export const periodTotalsShape = {
	days_with_data: countValue,
	invoices: optionalCountValue,
	net_amount: numericValue,
	gross_amount: numericValue,
	item_discount_amount: numericValue,
	bill_discount_amount: numericValue,
	voucher_amount: numericValue,
	discount_amount: numericValue,
	paid_amount: numericValue,
	cash_amount: numericValue,
	items_sold: numericValue,
	voucher_invoices: optionalCountValue,
	member_invoices: optionalCountValue,
	identified_invoices: optionalCountValue,
	voided_invoices: optionalCountValue,
	voided_amount: numericValue,
	edited_invoices: optionalCountValue,
	avg_ticket: numericValue,
	items_per_ticket: numericValue,
	avg_item_price: numericValue,
	cash_share: numericValue,
	voucher_share: numericValue,
	member_share: numericValue,
	identified_share: numericValue,
	discount_rate: numericValue,
} as const;

export const PERIOD_TOTAL_COLUMNS = Object.keys(
	periodTotalsShape,
) as readonly (keyof typeof periodTotalsShape)[];

export const storeCoverageArgs = z.object({
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
});

export const storeCoverageRow = z.object({
	store_id: storeIdValue,
	opened_on: optionalIsoDateValue,
	first_sales_on: optionalIsoDateValue,
	last_sales_on: optionalIsoDateValue,
	history_start: optionalIsoDateValue,
	store_as_of_date: isoDateValue,
	sales_days: countValue,
	checked_days: countValue,
	matched_days: countValue,
	unmatched_days: countValue,
	unchecked_sales_days: countValue,
	stale_days: countValue,
	last_refreshed_at: optionalTimestampValue,
});

export const periodCompareArgs = z.object({
	store_ids: storeIdsArgument,
	grain: reportGrainArgument,
	anchor: isoDateArgument,
});

export const periodCompareRow = z.object({
	period: z.enum(comparePeriods),
	from_date: isoDateValue,
	to_date: isoDateValue,
	days_with_data: countValue,
	invoices: optionalCountValue,
	net_amount: numericValue,
	gross_amount: numericValue,
	discount_amount: numericValue,
	avg_ticket: numericValue,
	items_per_ticket: numericValue,
	avg_item_price: numericValue,
	cash_share: numericValue,
	voucher_share: numericValue,
	member_share: numericValue,
	identified_share: numericValue,
});

export const periodCompareByStoreRow = z.object({
	store_id: storeIdValue,
	period: z.enum(comparePeriods),
	from_date: isoDateValue,
	to_date: isoDateValue,
	...periodTotalsShape,
});

export const periodSeriesArgs = z.object({
	store_ids: storeIdsArgument,
	grain: seriesGrainArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
	include_stores: z.boolean().optional(),
});

export const periodSeriesRow = z.object({
	store_id: storeIdValue,
	bucket_start: isoDateValue,
	bucket_end: isoDateValue,
	iso_year: optionalCountValue,
	iso_week: optionalCountValue,
	weekday: optionalCountValue,
	calendar_days: countValue,
	excluded_days: countValue,
	tet_days: countValue,
	holiday_kind: z.enum(holidayKinds).nullable(),
	checked_days: countValue,
	matched_days: countValue,
	...periodTotalsShape,
});

export const dailyBaselinesArgs = z.object({
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
	weeks: z.number().int().min(1).max(26).optional(),
});

export const dailyBaselineRow = z.object({
	business_date: isoDateValue,
	weekday: countValue,
	sample_days: countValue,
	baseline_net_amount: numericValue,
	baseline_invoices: numericValue,
	baseline_avg_ticket: numericValue,
});

export const hourlyProfileArgs = z.object({
	store_ids: storeIdsArgument,
	target_date: isoDateArgument,
	weeks: z.number().int().min(1).max(26).optional(),
});

export const hourlyProfileRow = z.object({
	hour_local: countValue,
	current_invoices: optionalCountValue,
	current_net_amount: numericValue,
	current_items_sold: numericValue,
	sample_days: countValue,
	baseline_invoices: numericValue,
	baseline_net_amount: numericValue,
});

export const metricCompareArgs = z.object({
	store_ids: storeIdsArgument,
	metric_ids: z.array(z.string().min(1)).min(1).max(25),
	grain: reportGrainArgument,
	anchor: isoDateArgument,
});

export const metricCompareRow = z.object({
	metric_id: textValue,
	period: z.enum(metricPeriods),
	from_date: isoDateValue,
	to_date: isoDateValue,
	value: numericValue,
});

export const itemSummaryArgs = z.object({
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
	compare_from: isoDateArgument.optional(),
	compare_to: isoDateArgument.optional(),
});

export const itemSummaryRow = z.object({
	item_external_id: textValue,
	item_name: textValue,
	base_name: optionalTextValue,
	size_label: optionalTextValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	role: z.enum(itemTypeRoles).nullable(),
	quantity: requiredNumericValue,
	net_amount: requiredNumericValue,
	invoices: countValue,
	days_sold: countValue,
	net_share: numericValue,
	compare_quantity: numericValue,
	compare_net_amount: numericValue,
	compare_net_share: numericValue,
	first_sold_on: optionalIsoDateValue,
	last_sold_on: optionalIsoDateValue,
});

export const paymentSummaryArgs = itemSummaryArgs;

export const paymentSummaryRow = z.object({
	method_key: textValue,
	kind: z.enum(paymentKinds),
	payment_method_name: optionalTextValue,
	invoices: countValue,
	amount: requiredNumericValue,
	share: numericValue,
	fee_amount: requiredNumericValue,
	fee_estimate_amount: requiredNumericValue,
	compare_amount: numericValue,
	compare_share: numericValue,
});

export const rangeArgs = z.object({
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
});

export const promotionSummaryRow = z.object({
	promotion_kind: z.enum(promotionKinds),
	promotion_key: textValue,
	promotion_name: optionalTextValue,
	invoices: countValue,
	lines: optionalCountValue,
	discount_amount: requiredNumericValue,
	first_used_on: isoDateValue,
	last_used_on: isoDateValue,
	days_used: countValue,
});

export const shiftReviewArgs = z.object({
	store_ids: storeIdsArgument,
	from_date: isoDateArgument,
	to_date: isoDateArgument,
	abs_threshold: z.number().min(0).optional(),
	rel_threshold: z.number().min(0).optional(),
});

export const shiftReviewRow = z.object({
	store_id: storeIdValue,
	shift_id: textValue,
	shift_external_id: textValue,
	shift_name: optionalTextValue,
	business_date: isoDateValue,
	cashier_name: optionalTextValue,
	opened_at: timestampValue,
	closed_at: optionalTimestampValue,
	orders: countValue,
	sales_amount: requiredNumericValue,
	cash_sales_amount: requiredNumericValue,
	opening_float_amount: numericValue,
	expected_cash_amount: numericValue,
	drawer_amount: numericValue,
	variance_amount: numericValue,
	trailing_shifts: optionalCountValue,
	z_score: numericValue,
	over_abs_threshold: z.boolean(),
	over_rel_threshold: z.boolean(),
	over_z_threshold: z.boolean(),
	flagged: z.boolean(),
	reasons: textListValue,
});

export const storeTargetsArgs = z.object({
	store_ids: storeIdsArgument,
	period_kind: z.enum(["month", "week"]),
	period_start: isoDateArgument,
});

export const storeTargetRow = z.object({
	store_id: storeIdValue,
	net_target_amount: requiredNumericValue,
});

export const itemVelocityArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
});

export const itemVelocityRow = z.object({
	item_external_id: textValue,
	item_name: textValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	recent_quantity: requiredNumericValue,
	prior_quantity: requiredNumericValue,
	recent_net_amount: requiredNumericValue,
	prior_net_amount: requiredNumericValue,
	quantity_change_pct: numericValue,
	net_change_pct: numericValue,
});

export const monthPaceArgs = z.object({
	store_ids: storeIdsArgument,
	month_start: isoDateArgument,
	as_of: isoDateArgument.optional(),
});

export const monthPaceRow = z.object({
	period_start: isoDateValue,
	as_of_date: isoDateValue,
	elapsed_days: countValue,
	remaining_days: countValue,
	month_to_date_net_amount: requiredNumericValue,
	month_to_date_invoices: countValue,
	forecast_weekday_profile_net_amount: numericValue,
	forecast_seasonal_naive_net_amount: numericValue,
	target_net_amount: numericValue,
});

export const forecastAccuracyArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
	days: z.number().int().min(1).max(366).optional(),
});

export const forecastAccuracyRow = z.object({
	forecast_id: z.enum(forecastIds),
	sample_days: countValue,
	mae: numericValue,
	mape: numericValue,
});

export const itemLifecycleArgs = z.object({
	store_ids: storeIdsArgument,
	as_of_date: isoDateArgument,
});

export const itemLifecycleRow = z.object({
	item_external_id: textValue,
	item_name: textValue,
	item_type_external_id: optionalTextValue,
	item_type_name: optionalTextValue,
	role: z.enum(itemTypeRoles).nullable(),
	first_sold_on: optionalIsoDateValue,
	last_sold_on: optionalIsoDateValue,
	months_sold: countValue,
	quantity_28d: numericValue,
	quantity_prior_28d: numericValue,
	quantity_ytd: numericValue,
	quantity_last_ytd: numericValue,
	net_ytd: numericValue,
	net_last_ytd: numericValue,
	quantity_lifetime: numericValue,
	net_lifetime: numericValue,
});
