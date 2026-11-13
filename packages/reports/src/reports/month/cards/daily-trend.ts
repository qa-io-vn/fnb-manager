import type { HolidayKind, IsoDate } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartMarkArea,
	ChartModel,
	ChartSeriesModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { isoWeekday } from "../../../period/dates.js";
import { monthKeys } from "../keys.js";
import {
	monthCalls,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthValue,
	seriesRows,
} from "../support.js";

const MONEY_DIGITS = 2;

export interface TrendDay {
	readonly date: IsoDate;
	readonly weekday: number;
	readonly net: number | null;
	readonly invoices: number | null;
	readonly baseline: number | null;
	readonly deviation: number | null;
	readonly holiday: HolidayKind | null;
	readonly closed: boolean;
}

export function holidayKey(kind: HolidayKind): string {
	return reportKeys.holiday[kind];
}

export function trendDays(input: CardInput): TrendDay[] {
	const baselines = new Map(
		(input.results.rows(monthCalls.baselines, "daily_baselines") ?? []).map(
			(row) => [row.business_date, row],
		),
	);
	return seriesRows(input, monthCalls.days)
		.filter((row) => row.store_id === null)
		.slice()
		.sort((left, right) => (left.bucket_start < right.bucket_start ? -1 : 1))
		.map((row) => {
			const hasData = row.days_with_data > 0;
			const usual = baselines.get(row.bucket_start);
			const baseline =
				usual !== undefined && usual.sample_days >= 1
					? usual.baseline_net_amount
					: null;
			const net = hasData ? row.net_amount : null;
			return {
				date: row.bucket_start,
				weekday: row.weekday ?? isoWeekday(row.bucket_start),
				net,
				invoices: hasData ? row.invoices : null,
				baseline,
				deviation: relativeChange(net, baseline),
				holiday: row.holiday_kind,
				closed: !hasData && row.checked_days > 0,
			};
		});
}

export function extremes(
	days: readonly TrendDay[],
): { best: TrendDay; worst: TrendDay } | null {
	let best: TrendDay | null = null;
	let worst: TrendDay | null = null;
	let measured = 0;
	for (const day of days) {
		if (day.deviation === null) continue;
		measured += 1;
		if (best === null || day.deviation > (best.deviation ?? 0)) best = day;
		if (worst === null || day.deviation < (worst.deviation ?? 0)) worst = day;
	}
	if (best === null || worst === null || measured < 2) return null;
	return { best, worst };
}

function holidayNote(
	pair: { best: TrendDay; worst: TrendDay } | null,
): SentencePart | null {
	if (pair === null) return null;
	for (const day of [pair.best, pair.worst]) {
		if (day.holiday === null) continue;
		return part(monthKeys.days.holidayNote, {
			day: textValue("date", day.date),
			holiday: messageValue(holidayKey(day.holiday)),
		});
	}
	return null;
}

function trendTable(days: readonly TrendDay[]): TableModel {
	const anyClosed = days.some((day) => day.closed);
	const columns: TableColumnModel[] = [
		column("date", reportKeys.table.date, "date"),
		column("weekday", reportKeys.table.weekday, "weekday"),
		column("net", reportKeys.table.netAmount, "money"),
		column("invoices", reportKeys.table.invoices, "count"),
		column("baseline", reportKeys.table.baseline, "money"),
		column("deviation", monthKeys.table.deviation, "signedPercent"),
		column("holiday", monthKeys.table.holiday, "message"),
		...(anyClosed ? [column("state", reportKeys.table.state, "message")] : []),
	];
	return tableModel({
		captionKey: monthKeys.days.table,
		columns,
		rows: days.map((day) => ({
			id: day.date,
			cells: {
				date: day.date,
				weekday: day.weekday,
				net: day.net,
				invoices: day.invoices,
				baseline: day.baseline,
				deviation: day.deviation,
				holiday: day.holiday === null ? null : holidayKey(day.holiday),
				state: day.closed ? monthKeys.days.closed : null,
			},
		})),
	});
}

export function tetAreas(days: readonly TrendDay[]): ChartMarkArea[] {
	const areas: ChartMarkArea[] = [];
	let start: number | null = null;
	days.forEach((day, index) => {
		const tet = day.holiday === "tet";
		if (tet && start === null) start = index;
		const last = index === days.length - 1;
		const next = days[index + 1];
		if (start !== null && (last || next?.holiday !== "tet")) {
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

function trendChart(days: readonly TrendDay[]): ChartModel {
	const anyHoliday = days.some(
		(day) => day.holiday !== null && day.net !== null,
	);
	const series: ChartSeriesModel[] = [
		{
			label: part(monthKeys.days.regularDays),
			kind: "bar",
			tone: "primary",
			axis: "left",
			stack: "net",
			values: days.map((day) => (day.holiday === null ? day.net : null)),
		},
	];
	if (anyHoliday) {
		series.push({
			label: part(monthKeys.days.holidayDays),
			kind: "bar",
			tone: "muted",
			axis: "left",
			stack: "net",
			values: days.map((day) => (day.holiday === null ? null : day.net)),
		});
	}
	series.push({
		label: part(reportKeys.periodRow.baseline),
		kind: "line",
		tone: "secondary",
		axis: "left",
		stack: null,
		values: days.map((day) => day.baseline),
	});
	return {
		labelKey: monthKeys.days.chart,
		categories: days.map((day) => textValue("date", day.date)),
		series,
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: tetAreas(days),
	};
}

export function buildDailyTrendCard(input: CardInput): CardModel {
	const { context } = input;
	const days = trendDays(input);
	const withData = days.filter((day) => day.net !== null);
	const average = ratio(
		sumMoney(withData.map((day) => day.net)),
		withData.length,
		MONEY_DIGITS,
	);
	const pair = extremes(days);
	const note = holidayNote(pair);
	const month = monthValue(context);
	const main: SentencePart =
		withData.length === 0
			? part(monthKeys.days.noData, { month })
			: pair === null
				? part(monthKeys.days.average, {
						month,
						value: numberValue("money", average ?? 0),
						days: numberValue("count", withData.length),
					})
				: part(monthKeys.days.main, {
						month,
						best: textValue("date", pair.best.date),
						bestDelta: numberValue("signedPercent", pair.best.deviation ?? 0),
						worst: textValue("date", pair.worst.date),
						worstDelta: numberValue("signedPercent", pair.worst.deviation ?? 0),
					});
	return {
		id: "daily_trend",
		titleKey: monthKeys.days.title,
		subtitle: null,
		metricId: "daily_net",
		relatedMetricIds: ["same_weekday_baseline"],
		headline: { value: average, unit: "money", caption: null },
		comparisons: [],
		decomposition: null,
		narrative: note === null ? [main] : [main, note],
		tables: [trendTable(days)],
		chart: withData.length === 0 ? null : trendChart(days),
		notice: null,
		markers: monthMarkers(input, false),
		csvName: monthCsvName(context, "daily_trend"),
	};
}

export const dailyTrendCard: CardDefinition = {
	id: "daily_trend",
	needs: monthNeeds.days,
	visible: () => true,
	build: buildDailyTrendCard,
};
