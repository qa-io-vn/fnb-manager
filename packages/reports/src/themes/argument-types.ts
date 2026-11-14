export const ARGUMENT_SQL_TYPES: Readonly<Record<string, string>> = {
	store_ids: "uuid[]",
	grain: "text",
	anchor: "date",
	from_date: "date",
	to_date: "date",
	from_dates: "date[]",
	to_dates: "date[]",
	compare_from: "date",
	compare_to: "date",
	metric_ids: "text[]",
	target_date: "date",
	weeks: "integer",
	as_of_date: "date",
	as_of: "date",
	month_start: "date",
	days: "integer",
	abs_threshold: "numeric",
	rel_threshold: "numeric",
	period_kind: "public.period_kind",
	period_start: "date",
	include_stores: "boolean",
	peak_hours: "integer",
	dead_hour_ratio: "numeric",
	busy_hour_ratio: "numeric",
	window_days: "integer",
	popularity_factor: "numeric",
	low_sample_items: "integer",
	min_pair_invoices: "integer",
	max_pairs: "integer",
};

export function argumentSqlType(name: string): string | undefined {
	return Object.hasOwn(ARGUMENT_SQL_TYPES, name)
		? ARGUMENT_SQL_TYPES[name]
		: undefined;
}
