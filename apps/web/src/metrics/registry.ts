import {
	type MetricDirection,
	metricById,
	type MetricId as RegistryMetricId,
	type MetricUnit as RegistryMetricUnit,
} from "@fnb/metrics";
import type { MessageKey } from "../i18n";

export type { MetricDirection };
export type MetricUnit =
	| "money"
	| "count"
	| "decimal"
	| "fraction"
	| "percentChange";

export const registryMetricIds = [
	"net_revenue",
	"invoices",
	"avg_ticket",
	"items_per_ticket",
	"avg_item_price",
	"gross_revenue",
	"cash_share",
	"voucher_invoice_share",
	"member_invoice_share",
	"customer_capture_rate",
	"discount_rate",
	"peak_share_20_21",
	"weekday_share",
	"sales_per_opening_hour",
	"invoices_per_opening_hour",
	"revpash",
	"peak_share_top_hours",
	"dead_hour_share",
	"same_weekday_baseline",
	"forecast_weekday_profile",
	"forecast_seasonal_naive",
	"forecast_mae",
	"item_velocity",
	"size_l_share",
	"attach_rate_topping",
	"attach_rate_snack",
	"cash_variance",
	"cash_variance_zscore",
	"menu_class",
	"gross_margin_rate",
	"cost_coverage",
	"payment_fee_estimate",
] as const satisfies readonly RegistryMetricId[];

export const displaySeries = {
	hourly_net: { unit: "money", direction: "neutral" },
	item_net: { unit: "money", direction: "neutral" },
	cash_to_count: { unit: "money", direction: "neutral" },
	discount_cost: { unit: "money", direction: "neutral" },
	flagged_shifts: { unit: "count", direction: "lower" },
	weekday_net: { unit: "money", direction: "neutral" },
	category_net_share: { unit: "fraction", direction: "neutral" },
	daily_net: { unit: "money", direction: "neutral" },
	item_pareto_count: { unit: "count", direction: "neutral" },
	new_item_count: { unit: "count", direction: "neutral" },
	target_progress: { unit: "fraction", direction: "higher" },
	month_year_net: { unit: "money", direction: "neutral" },
	seasonality_index: { unit: "decimal", direction: "neutral" },
	item_lifecycle_count: { unit: "count", direction: "neutral" },
	since_opening_net: { unit: "money", direction: "higher" },
	moving_average_net: { unit: "money", direction: "neutral" },
	month_net: { unit: "money", direction: "neutral" },
	store_net_share: { unit: "fraction", direction: "neutral" },
	hour_heat: { unit: "money", direction: "neutral" },
	busy_window: { unit: "count", direction: "neutral" },
	pair_lift: { unit: "decimal", direction: "neutral" },
	modifier_pref: { unit: "fraction", direction: "neutral" },
	shift_net: { unit: "money", direction: "neutral" },
	store_day_index: { unit: "decimal", direction: "neutral" },
} as const satisfies Record<
	string,
	{ unit: MetricUnit; direction: MetricDirection }
>;

export type DisplaySeriesId = keyof typeof displaySeries;

export const displaySeriesIds = Object.keys(
	displaySeries,
) as readonly DisplaySeriesId[];

export type MetricId = (typeof registryMetricIds)[number] | DisplaySeriesId;

export interface MetricDefinition {
	id: MetricId;
	direction: MetricDirection;
	unit: MetricUnit;
	labelKey: MessageKey;
	formulaKey: MessageKey;
	grainKey: MessageKey;
	conventionKey: MessageKey;
	missingKey?: MessageKey;
}

const unitOfRegistryUnit: Partial<Record<RegistryMetricUnit, MetricUnit>> = {
	VND: "money",
	count: "count",
	items: "decimal",
	z: "decimal",
	fraction: "fraction",
	"% change": "percentChange",
	"VND and count": "money",
	"VND / hour": "money",
	"count / hour": "decimal",
	"VND / seat-hour": "money",
	class: "count",
};

export function webUnitOf(unit: RegistryMetricUnit): MetricUnit {
	const mapped = unitOfRegistryUnit[unit];
	if (mapped === undefined) {
		throw new Error(`the web has no display unit for registry unit ${unit}`);
	}
	return mapped;
}

function define(
	id: MetricId,
	direction: MetricDirection,
	unit: MetricUnit,
): MetricDefinition {
	return {
		id,
		direction,
		unit,
		labelKey: `metric.${id}.label`,
		formulaKey: `metric.${id}.formula`,
		grainKey: `metric.${id}.grain`,
		conventionKey: `metric.${id}.convention`,
	};
}

function fromRegistry(
	id: (typeof registryMetricIds)[number],
): MetricDefinition {
	const metric = metricById(id);
	return define(id, metric.direction, webUnitOf(metric.unit));
}

export const metricRegistry = Object.fromEntries([
	...registryMetricIds.map((id) => [id, fromRegistry(id)] as const),
	...displaySeriesIds.map(
		(id) =>
			[
				id,
				define(id, displaySeries[id].direction, displaySeries[id].unit),
			] as const,
	),
]) as Record<MetricId, MetricDefinition>;

export function isWebMetricId(id: string): id is MetricId {
	return Object.hasOwn(metricRegistry, id);
}

export type ChipTone = "positive" | "negative" | "neutral";

export function toneForChange(
	direction: MetricDirection,
	change: number | null,
): ChipTone {
	if (change === null || change === 0 || direction === "neutral")
		return "neutral";
	const improved = direction === "higher" ? change > 0 : change < 0;
	return improved ? "positive" : "negative";
}
