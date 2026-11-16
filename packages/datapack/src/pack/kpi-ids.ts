import { currentMetricIds, metricValueIds } from "@fnb/metrics";

export const KPI_WINDOW_DAYS = 28;
export const KPI_EXCLUDED_METRIC_IDS: readonly string[] = ["void_rate"];

export function trackableMetricIds(): readonly string[] {
	const current = new Set<string>(currentMetricIds());
	const excluded = new Set(KPI_EXCLUDED_METRIC_IDS);
	return metricValueIds().filter((id) => current.has(id) && !excluded.has(id));
}
