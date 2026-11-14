import type { IsoDate } from "../../../contract/values.js";
import type {
	CardModel,
	ChartMarkArea,
	ChartModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { FLAT_THRESHOLD } from "../../../model/narrative.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import {
	RANGE_INDEX,
	rangeRow,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { revenueKeys } from "../keys.js";
import {
	revenueCalls,
	revenueCsvName,
	revenueNeeds,
	type SeriesRow,
	seriesRowsOf,
	type TrendGrain,
	totalsRowsOf,
	trendPlan,
} from "../support.js";

const MONEY_DIGITS = 2;

export interface TrendPoint {
	readonly start: IsoDate;
	readonly net: number | null;
	readonly average: number | null;
	readonly lastYearAverage: number | null;
	readonly change: number | null;
	readonly tet: boolean;
}

export function movingAverages(
	rows: readonly SeriesRow[],
	points: number,
): (number | null)[] {
	return rows.map((_, index) => {
		if (index + 1 < points) return null;
		const window = rows
			.slice(index + 1 - points, index + 1)
			.filter((row) => row.days_with_data > 0);
		if (window.length === 0) return null;
		return ratio(
			sumMoney(window.map((row) => row.net_amount)),
			window.length,
			MONEY_DIGITS,
		);
	});
}

function inRange(row: SeriesRow, from: IsoDate, grain: TrendGrain): boolean {
	return grain === "day" ? row.bucket_start >= from : row.bucket_end >= from;
}

export function trendPoints(input: ThemeCardInput): {
	readonly grain: TrendGrain;
	readonly points: number;
	readonly series: readonly TrendPoint[];
	readonly complete: boolean;
} {
	const { range } = input.context;
	const plan = trendPlan(range, range.days);
	const rows = seriesRowsOf(input.results, revenueCalls.series);
	const averages = movingAverages(rows, plan.points);
	const lastYearRows = seriesRowsOf(input.results, revenueCalls.seriesLastYear);
	const lastYearAverages = movingAverages(lastYearRows, plan.points);
	const first = rows.findIndex((row) => inRange(row, range.from, plan.grain));
	const offset = first < 0 ? rows.length : first;
	const series = rows.slice(offset).map((row, index) => {
		const average = averages[offset + index] ?? null;
		const lastYearAverage =
			lastYearRows.length === 0
				? null
				: (lastYearAverages[offset + index] ?? null);
		return {
			start: row.bucket_start,
			net: row.days_with_data > 0 ? row.net_amount : null,
			average,
			lastYearAverage,
			change: relativeChange(average, lastYearAverage),
			tet: plan.grain === "day" ? row.holiday_kind === "tet" : row.tet_days > 0,
		};
	});
	return {
		grain: plan.grain,
		points: plan.points,
		series,
		complete: rows.length >= plan.points,
	};
}

export function tetAreas(points: readonly TrendPoint[]): ChartMarkArea[] {
	const areas: ChartMarkArea[] = [];
	let start: number | null = null;
	points.forEach((point, index) => {
		if (point.tet && start === null) start = index;
		const next = points[index + 1];
		if (start !== null && (next === undefined || !next.tet)) {
			areas.push({
				label: part(reportKeys.holiday.tet),
				fromIndex: start,
				toIndex: index,
			});
			start = null;
		}
	});
	return areas;
}

function trendTable(
	grain: TrendGrain,
	points: readonly TrendPoint[],
	withLastYear: boolean,
): TableModel {
	return tableModel({
		captionKey: revenueKeys.trend.table,
		columns: [
			column(
				"date",
				grain === "day" ? reportKeys.table.date : revenueKeys.table.week,
				"date",
			),
			column("net", reportKeys.table.netAmount, "money"),
			column("average", revenueKeys.trend.movingAverage, "money"),
			...(withLastYear
				? [
						column(
							"lastYearAverage",
							revenueKeys.trend.lastYearAverage,
							"money",
						),
						column("change", revenueKeys.table.changeLastYear, "signedPercent"),
					]
				: []),
		],
		rows: points.map((point) => ({
			id: point.start,
			cells: {
				date: point.start,
				net: point.net,
				average: point.average,
				lastYearAverage: point.lastYearAverage,
				change: point.change,
			},
		})),
	});
}

function trendChart(
	points: readonly TrendPoint[],
	withLastYear: boolean,
): ChartModel {
	return {
		labelKey: revenueKeys.trend.chart,
		categories: points.map((point) => textValue("date", point.start)),
		series: [
			{
				label: part(revenueKeys.trend.netSeries),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: points.map((point) => point.net),
			},
			{
				label: part(revenueKeys.trend.movingAverage),
				kind: "line",
				tone: "secondary",
				axis: "left",
				stack: null,
				values: points.map((point) => point.average),
			},
			...(withLastYear
				? [
						{
							label: part(revenueKeys.trend.lastYearAverage),
							kind: "line" as const,
							tone: "muted" as const,
							axis: "left" as const,
							stack: null,
							values: points.map((point) => point.lastYearAverage),
						},
					]
				: []),
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: tetAreas(points),
	};
}

function mainClause(
	input: ThemeCardInput,
	points: readonly TrendPoint[],
): SentencePart {
	const range = rangeValue(input.context);
	const measured = points.filter((point) => point.average !== null);
	const first = measured[0]?.average ?? null;
	const last = measured[measured.length - 1]?.average ?? null;
	const change = relativeChange(last, first);
	if (
		first === null ||
		last === null ||
		change === null ||
		measured.length < 2
	) {
		return part(revenueKeys.trend.noData, { range });
	}
	const values = {
		range,
		from: numberValue("money", first),
		to: numberValue("money", last),
		delta: numberValue("percent", Math.abs(change)),
	};
	if (Math.abs(change) < FLAT_THRESHOLD)
		return part(revenueKeys.trend.steady, values);
	return part(
		change > 0 ? revenueKeys.trend.rising : revenueKeys.trend.falling,
		values,
	);
}

export function buildTrendCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const { grain, points, series, complete } = trendPoints(input);
	const withData = series.filter((point) => point.net !== null);
	const current = rangeRow(totalsRowsOf(input.results), RANGE_INDEX.current);
	const perDay =
		current === undefined || current.days_with_data === 0
			? null
			: ratio(current.net_amount, current.days_with_data, MONEY_DIGITS);
	const withLastYear = context.range.lastYear !== null;
	const narrative: SentencePart[] = [];
	if (withData.length > 0) {
		narrative.push(mainClause(input, series));
		if (series.some((point) => point.tet))
			narrative.push(part(revenueKeys.trend.tetNote));
	}
	return {
		id: "trend",
		titleKey: revenueKeys.trend.title,
		subtitle: null,
		metricId: "moving_average_net",
		relatedMetricIds: ["net_revenue"],
		headline: {
			value: perDay,
			unit: "money",
			caption: part(revenueKeys.trend.caption, {
				points: numberValue("count", points),
			}),
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: [trendTable(grain, series, withLastYear)],
		chart: withData.length === 0 ? null : trendChart(series, withLastYear),
		notice:
			complete || withData.length === 0
				? null
				: {
						tone: "info",
						part: part(revenueKeys.trend.short, {
							points: numberValue("count", points),
						}),
						action: null,
					},
		markers: themeMarkers(input, false),
		csvName: revenueCsvName(context, "trend"),
	};
}

export const revenueTrendCard: ThemeCardDefinition = {
	id: "trend",
	needs: [...revenueNeeds.trend, ...revenueNeeds.stores],
	visible: () => true,
	build: buildTrendCard,
};
