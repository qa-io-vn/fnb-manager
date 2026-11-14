import { baselineMetrics } from "./metrics/baselines.js";
import { cashMetrics } from "./metrics/cash.js";
import { customerMetrics } from "./metrics/customers.js";
import { menuMetrics } from "./metrics/menu.js";
import { salesMetrics } from "./metrics/sales.js";
import { timeMetrics } from "./metrics/time.js";
import type {
	MetricDefinition,
	MetricGrain,
	MetricGroup,
	ReportId,
} from "./vocabulary.js";
import { storeGrains } from "./vocabulary.js";

export const metrics = [
	...salesMetrics,
	...timeMetrics,
	...baselineMetrics,
	...menuMetrics,
	...cashMetrics,
	...customerMetrics,
] as const satisfies readonly MetricDefinition[];

export type Metric = (typeof metrics)[number];
export type MetricId = Metric["id"];
export type MetricOf<Id extends MetricId> = Extract<Metric, { id: Id }>;

const groupsWithoutStorePeriodValue: readonly MetricGroup[] = ["baselines"];

export function isMetricId(candidate: string): candidate is MetricId {
	return metrics.some((metric) => metric.id === candidate);
}

export function findMetric(id: string): Metric | undefined {
	return metrics.find((metric) => metric.id === id);
}

export function metricById<Id extends MetricId>(id: Id): MetricOf<Id> {
	const metric = findMetric(id);
	if (metric === undefined) throw new Error(`unknown metric ${id}`);
	return metric as MetricOf<Id>;
}

export function metricsForReport(report: ReportId): Metric[] {
	return metrics.filter((metric) => {
		const reports: readonly ReportId[] = metric.reports;
		return reports.includes(report);
	});
}

export function metricsInGroup(group: MetricGroup): Metric[] {
	return metrics.filter((metric) => metric.group === group);
}

function definitionOf(metric: MetricDefinition | MetricId): MetricDefinition {
	return typeof metric === "string" ? metricById(metric) : metric;
}

export function isAvailableNow(metric: MetricDefinition | MetricId): boolean {
	return definitionOf(metric).status === "available now";
}

export function hasStorePeriodValue(
	metric: MetricDefinition | MetricId,
): boolean {
	const definition = definitionOf(metric);
	const grains: readonly MetricGrain[] = storeGrains;
	return (
		!groupsWithoutStorePeriodValue.includes(definition.group) &&
		definition.grains.some((grain) => grains.includes(grain))
	);
}

export const ownFunctions: Readonly<Partial<Record<string, string>>> = {
	peak_share_top_hours: "hour_profile",
	dead_hour_share: "hour_profile",
};

export const supersededBy: Readonly<Partial<Record<string, string>>> = {
	peak_share_20_21: "peak_share_top_hours",
	dead_hour_share_17_18: "dead_hour_share",
};

export function ownFunctionOf(
	metric: MetricDefinition | MetricId,
): string | null {
	return ownFunctions[definitionOf(metric).id] ?? null;
}

export function supersedingMetricOf(
	metric: MetricDefinition | MetricId,
): string | null {
	return supersededBy[definitionOf(metric).id] ?? null;
}

export function isComputedByMetricValue(
	metric: MetricDefinition | MetricId,
): boolean {
	return (
		isAvailableNow(metric) &&
		hasStorePeriodValue(metric) &&
		ownFunctionOf(metric) === null
	);
}

export function currentMetricIds(): MetricId[] {
	return metrics
		.filter((metric) => supersedingMetricOf(metric) === null)
		.map((metric) => metric.id);
}

export function metricValueIds(): MetricId[] {
	return metrics
		.filter((metric) => isComputedByMetricValue(metric))
		.map((metric) => metric.id);
}
