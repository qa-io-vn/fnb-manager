import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartSeriesModel,
	NoticeModel,
} from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	withUnit,
} from "../../../model/comparison.js";
import { lastYearLabelKey, reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { difference } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type TypedValue } from "../../../model/values.js";
import { dayKeys } from "../keys.js";
import {
	dayCsvName,
	dayMarkers,
	dayNeeds,
	dayValue,
	type HourRow,
	hourAxis,
	hourRows,
	likeForLikeMetrics,
	metricRows,
} from "../support.js";
import { hourDrivers } from "./totals-card.js";

export const PEAK_SHARE_METRIC = "peak_share_20_21";

export function trimmedHours(
	rows: readonly HourRow[],
	startMinutes: number,
	withBaseline: boolean,
): HourRow[] {
	const byHour = new Map(rows.map((row) => [row.hour_local, row]));
	const axis = hourAxis(startMinutes).flatMap((hour) => {
		const row = byHour.get(hour);
		return row === undefined ? [] : [row];
	});
	const active = (row: HourRow) =>
		(row.current_net_amount ?? 0) !== 0 ||
		(withBaseline && (row.baseline_net_amount ?? 0) !== 0);
	const first = axis.findIndex(active);
	if (first < 0) return [];
	let last = axis.length - 1;
	while (last > first && !active(axis[last] as HourRow)) last -= 1;
	return axis.slice(first, last + 1);
}

function peakOf(rows: readonly HourRow[]): HourRow | null {
	let peak: HourRow | null = null;
	for (const row of rows) {
		const net = row.current_net_amount;
		if (net === null) continue;
		if (peak === null || net > (peak.current_net_amount ?? 0)) peak = row;
	}
	return peak;
}

export function buildHourlyCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = hourRows(input);
	const sampleDays = rows[0]?.sample_days ?? 0;
	const withBaseline = sampleDays > 0;
	const hasData = rows.some((row) => row.current_net_amount !== null);
	const hours = trimmedHours(
		rows,
		context.stores[0]?.businessDayStartMinutes ?? 0,
		withBaseline,
	);
	const peak = peakOf(hours);
	const peakNet = hasData ? (peak?.current_net_amount ?? 0) : null;
	const sold = peakNet !== null && peakNet > 0;
	const metrics = metricRows(input);
	const share =
		metrics.find(
			(row) => row.metric_id === PEAK_SHARE_METRIC && row.period === "current",
		)?.value ?? null;
	const comparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input),
			coverage,
			metricId: PEAK_SHARE_METRIC,
			kinds: ["previous"],
			labels: {
				previous: part(dayKeys.hourly.shareCompare),
				last_year: part(lastYearLabelKey("day")),
			},
		}),
		"fraction",
	);
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (sold && peak !== null) {
		values.hour = numberValue("hour", peak.hour_local);
		values.value = numberValue("money", peakNet);
	}
	if (share !== null) values.share = numberValue("percent", share);
	const peakKey =
		share === null ? dayKeys.hourly.peakWithoutShare : dayKeys.hourly.peak;
	const series: ChartSeriesModel[] = [
		{
			label: part(reportKeys.periodRow.current),
			kind: "line",
			tone: "primary",
			axis: "left",
			stack: null,
			values: hours.map((row) => row.current_net_amount),
		},
	];
	if (withBaseline) {
		series.push({
			label: part(reportKeys.periodRow.baseline),
			kind: "line",
			tone: "muted",
			axis: "left",
			stack: null,
			values: hours.map((row) => row.baseline_net_amount),
		});
	}
	const notice: NoticeModel | null =
		hasData && !withBaseline
			? { tone: "info", part: part(dayKeys.hourly.noBaseline), action: null }
			: null;
	return {
		id: "hourly",
		titleKey: dayKeys.hourly.title,
		subtitle: null,
		metricId: "hourly_net",
		relatedMetricIds: [PEAK_SHARE_METRIC],
		headline: {
			value: peakNet,
			unit: "money",
			caption:
				sold && peak !== null
					? part(dayKeys.hourly.caption, {
							hour: numberValue("hour", peak.hour_local),
						})
					: null,
		},
		comparisons,
		decomposition: null,
		narrative: narrate({
			main: {
				up: peakKey,
				down: peakKey,
				flat: peakKey,
				noReference: peakKey,
				noData: dayKeys.hourly.noData,
			},
			values,
			current: sold ? peakNet : null,
			comparison: null,
			notes: [],
			drivers: withBaseline
				? hourDrivers(
						input,
						(row) => row.current_net_amount,
						(row) => row.baseline_net_amount,
						"money",
					)
				: [],
			decomposition: null,
		}),
		tables: [
			tableModel({
				captionKey: dayKeys.hourly.table,
				columns: [
					column("hour", reportKeys.table.hour, "hour"),
					column("net", reportKeys.table.netAmount, "money"),
					column("baseline", reportKeys.table.baseline, "money"),
					column("difference", reportKeys.table.difference, "money"),
					column("invoices", reportKeys.table.invoices, "count"),
					column(
						"baselineInvoices",
						reportKeys.table.baselineInvoices,
						"decimal",
					),
				],
				rows: hours.map((row) => ({
					id: String(row.hour_local),
					cells: {
						hour: row.hour_local,
						net: row.current_net_amount,
						baseline: withBaseline ? row.baseline_net_amount : null,
						difference: withBaseline
							? difference(row.current_net_amount, row.baseline_net_amount)
							: null,
						invoices: row.current_invoices,
						baselineInvoices: withBaseline ? row.baseline_invoices : null,
					},
				})),
			}),
		],
		chart:
			hours.length === 0
				? null
				: {
						labelKey: dayKeys.hourly.chart,
						categories: hours.map((row) => numberValue("hour", row.hour_local)),
						series,
						leftUnit: "money",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice,
		markers: dayMarkers(input, false),
		csvName: dayCsvName(context, "hourly"),
	};
}

export const hourlyCard: CardDefinition = {
	id: "hourly",
	needs: dayNeeds.hourly,
	visible: () => true,
	build: buildHourlyCard,
};
