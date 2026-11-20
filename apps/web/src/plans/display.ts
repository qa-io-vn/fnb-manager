import { findMetric, type ReportId } from "@fnb/metrics";
import type { StoreRow } from "../data/row-source";
import type { Formatters } from "../lib/format";
import {
	isWebMetricId,
	type MetricUnit,
	metricRegistry,
} from "../metrics/registry";

export const REPORT_PATHS: Partial<Record<ReportId, string>> = {
	day: "/bao-cao/ngay",
	week: "/bao-cao/tuan",
	month: "/bao-cao/thang",
	year: "/bao-cao/nam",
	revenue: "/chu-de/doanh-thu",
	hours: "/chu-de/gio-ngay",
	menu: "/chu-de/thuc-don",
	payments: "/chu-de/thanh-toan",
	promotions: "/chu-de/khuyen-mai",
	shifts: "/chu-de/ca-ket-tien",
	stores: "/chu-de/so-sanh",
	data_quality: "/chu-de/chat-luong",
	customers: "/khach-hang",
};

export function unitOf(metricId: string): MetricUnit {
	return isWebMetricId(metricId) ? metricRegistry[metricId].unit : "decimal";
}

export function isFraction(metricId: string): boolean {
	return unitOf(metricId) === "fraction";
}

export function formatKpiValue(
	formatters: Formatters,
	metricId: string,
	value: number | null,
): string | null {
	if (value === null || !Number.isFinite(value)) return null;
	switch (unitOf(metricId)) {
		case "money":
			return formatters.moneyExact(value);
		case "count":
			return formatters.count(value);
		case "fraction":
			return formatters.percentExact(value);
		default:
			return formatters.decimal(value);
	}
}

export function formatKpiChange(
	formatters: Formatters,
	metricId: string,
	baseline: number,
	current: number | null,
): string | null {
	if (current === null || !Number.isFinite(current)) return null;
	if (isFraction(metricId)) return formatters.points(current - baseline);
	if (baseline === 0) return null;
	return formatters.signedPercent((current - baseline) / Math.abs(baseline));
}

export function reportLinkOf(
	metricId: string,
	storeIds: readonly string[],
): string | null {
	const metric = findMetric(metricId);
	if (metric === undefined) return null;
	for (const report of metric.reports) {
		const path = REPORT_PATHS[report];
		if (path !== undefined) {
			return storeIds.length === 1
				? `${path}?store=${encodeURIComponent(storeIds[0] as string)}`
				: path;
		}
	}
	return null;
}

export function storeSetKey(storeIds: readonly string[]): string {
	return [...storeIds].sort().join(",");
}

export function storeNames(
	stores: readonly StoreRow[],
	storeIds: readonly string[],
	unknown: string,
): string {
	const byId = new Map(stores.map((store) => [store.id, store.name]));
	const names = storeIds.map((id) => byId.get(id) ?? unknown);
	return [...new Set(names)]
		.sort((left, right) => left.localeCompare(right))
		.join(", ");
}
