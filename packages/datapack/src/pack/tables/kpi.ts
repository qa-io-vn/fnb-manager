import { findMetric } from "@fnb/metrics";
import { difference, relativeChange } from "@fnb/reports";
import { BAND_WINDOWS, KPI_WINDOWS, type KpiWindowName } from "../calendar.js";
import { scopedKey } from "../calls.js";
import type { PackScope } from "../coverage.js";
import { trackableMetricIds } from "../kpi-ids.js";
import type { PackTable } from "../schema.js";
import {
	columns,
	type PackRows,
	packRow,
	packTable,
	type TableContext,
	type TableSpec,
} from "./support.js";

export const KPI_SPEC: TableSpec = {
	grain: "metric-window",
	window: "w28",
	columns: columns([
		["w28", "metric"],
		["p28", "metric"],
		["ly28", "metric"],
		["p28_change", "metric_change"],
		["ly28_change", "metric_change"],
		["lo", "metric"],
		["hi", "metric"],
		["n", "count"],
	]),
};

const NORMAL_RANGE_WINDOWS: readonly KpiWindowName[] = ["w28", ...BAND_WINDOWS];

export function isFractionMetric(metricId: string): boolean {
	return findMetric(metricId)?.unit === "fraction";
}

export function kpiChange(
	metricId: string,
	current: number | null,
	reference: number | null,
): number | null {
	return isFractionMetric(metricId)
		? difference(current, reference)
		: relativeChange(current, reference);
}

export type KpiValueOf = (
	window: KpiWindowName,
	metricId: string,
) => number | null;

export function kpiValues(context: TableContext, scope: PackScope): KpiValueOf {
	const rows = context.results.rows(scopedKey("kpi", scope), "metric_windows");
	const values = new Map<string, number | null>();
	for (const row of rows) {
		values.set(`${row.range_index}|${row.metric_id}`, row.value);
	}
	return (window, metricId) => {
		if (!context.coverage.counts(scope, window)) return null;
		const index = KPI_WINDOWS.indexOf(window) + 1;
		return values.get(`${index}|${metricId}`) ?? null;
	};
}

export function kpiTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const value = kpiValues(context, scope);
		for (const metricId of trackableMetricIds()) {
			const w28 = value("w28", metricId);
			const p28 = value("p28", metricId);
			const ly28 = value("ly28", metricId);
			const band = NORMAL_RANGE_WINDOWS.map((window) =>
				value(window, metricId),
			).filter((entry): entry is number => entry !== null);
			rows[`${scope.label}/${metricId}`] = packRow(
				KPI_SPEC,
				[
					w28,
					p28,
					ly28,
					kpiChange(metricId, w28, p28),
					kpiChange(metricId, w28, ly28),
					band.length === 0 ? null : Math.min(...band),
					band.length === 0 ? null : Math.max(...band),
					band.length,
				],
				context.request.currency,
			);
		}
	}
	return packTable("kpi", context, KPI_SPEC, rows);
}
