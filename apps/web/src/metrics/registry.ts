import type {
	MetricDirection,
	MetricId as RegistryMetricId,
} from "@fnb/metrics";
import type { MessageKey } from "../i18n";

export type { MetricDirection };
export type MetricUnit = "money" | "count" | "fraction";

export const registryMetricIds = [
	"net_revenue",
	"invoices",
	"avg_ticket",
	"same_weekday_baseline",
] as const satisfies readonly RegistryMetricId[];

export const displaySeriesIds = [
	"hourly_net",
	"item_net",
	"cash_to_count",
] as const;

export type MetricId =
	| (typeof registryMetricIds)[number]
	| (typeof displaySeriesIds)[number];

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

export const metricRegistry: Record<MetricId, MetricDefinition> = {
	net_revenue: define("net_revenue", "higher", "money"),
	invoices: define("invoices", "higher", "count"),
	avg_ticket: define("avg_ticket", "higher", "money"),
	same_weekday_baseline: define("same_weekday_baseline", "neutral", "money"),
	hourly_net: define("hourly_net", "neutral", "money"),
	item_net: define("item_net", "neutral", "money"),
	cash_to_count: define("cash_to_count", "neutral", "money"),
};

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
