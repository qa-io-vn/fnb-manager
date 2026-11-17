import { findMetric, metricValueIds, supersedingMetricOf } from "@fnb/metrics";
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

export const METRICS_SPEC: TableSpec = {
	grain: "metric",
	window: null,
	columns: columns([
		["label", "text"],
		["unit", "class"],
		["direction", "class"],
		["trackable", "flag"],
		["superseded_by", "class"],
		["formula", "text"],
	]),
};

export function metricsTable(context: TableContext): PackTable {
	const trackable = new Set(trackableMetricIds());
	const rows: PackRows = {};
	for (const id of metricValueIds()) {
		const metric = findMetric(id);
		if (metric === undefined) continue;
		rows[id] = packRow(
			METRICS_SPEC,
			[
				metric.label[context.request.language],
				metric.unit,
				metric.direction,
				trackable.has(id),
				supersedingMetricOf(metric),
				metric.formula,
			],
			context.request.currency,
		);
	}
	return packTable("metrics", context, METRICS_SPEC, rows);
}
