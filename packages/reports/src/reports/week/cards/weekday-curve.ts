import type { IsoDate } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, ChartModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import {
	type DriverCandidate,
	narrate,
	strongestDriver,
} from "../../../model/narrative.js";
import {
	exactDifference,
	ratio,
	relativeChange,
} from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { addDays, isoWeekday } from "../../../period/dates.js";
import type { FourWeekAverage } from "../four-week-average.js";
import { weekKeys } from "../keys.js";
import {
	dayRowsOf,
	fullWeekDates,
	noDataNotice,
	WEEK_DAYS,
	type WeekDays,
	weekCsvName,
	weekdayValue,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";
import { weekAverage } from "./totals-card.js";

export const SHARE_DIGITS = 6;

interface CurveDay {
	readonly date: IsoDate;
	readonly weekday: number;
	readonly elapsed: boolean;
	readonly net: number | null;
	readonly lastWeek: number | null;
	readonly average: number | null;
	readonly coveredNet: number | null;
}

const pickNet = (row: { readonly net_amount: number | null }) => row.net_amount;

export function curveDays(
	input: CardInput,
	days: WeekDays,
	average: FourWeekAverage,
): CurveDay[] {
	const end = input.context.period.end;
	const covered = average.basis === "like_for_like" ? average.storeIds : null;
	return fullWeekDates(input.context).map((date) => {
		const elapsed = date <= end;
		const weekday = isoWeekday(date);
		const net = elapsed ? days.value(null, date, pickNet, "money") : null;
		return {
			date,
			weekday,
			elapsed,
			net,
			lastWeek: days.value(null, addDays(date, -WEEK_DAYS), pickNet, "money"),
			average: average.weekday(weekday).net,
			coveredNet:
				!elapsed || covered === null
					? net
					: days.value(covered, date, pickNet, "money"),
		};
	});
}

function strongestDay(entries: readonly CurveDay[]): CurveDay | null {
	let best: CurveDay | null = null;
	for (const entry of entries) {
		if (entry.net === null) continue;
		if (best === null || entry.net > (best.net ?? 0)) best = entry;
	}
	return best;
}

function deviationDrivers(entries: readonly CurveDay[]): DriverCandidate[] {
	return entries.flatMap((entry) => {
		if (!entry.elapsed || entry.average === null) return [];
		if (entry.coveredNet === null && entry.net === null) return [];
		return [
			{
				dimension: "weekday" as const,
				label: textValue("weekday", String(entry.weekday)),
				contribution: exactDifference(entry.coveredNet ?? 0, entry.average),
				unit: "money" as const,
			},
		];
	});
}

function driverPart(entries: readonly CurveDay[]): SentencePart | null {
	const strongest = strongestDriver(deviationDrivers(entries), 0);
	if (strongest === null) return null;
	return part(weekKeys.curve.driver, {
		weekday: strongest.candidate.label,
		delta: numberValue("moneySigned", strongest.candidate.contribution),
	});
}

function chartOf(
	entries: readonly CurveDay[],
	average: FourWeekAverage,
): ChartModel {
	return {
		labelKey: weekKeys.curve.chart,
		categories: entries.map((entry) => weekdayValue(entry.date)),
		series: [
			{
				label: part(weekKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.net),
			},
			{
				label: part(weekKeys.periodRow.previous),
				kind: "line",
				tone: "secondary",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.lastWeek),
			},
			{
				label: part(
					average.basis === "like_for_like"
						? weekKeys.curve.averageSeriesLikeForLike
						: weekKeys.curve.averageSeries,
				),
				kind: "line",
				tone: "tertiary",
				axis: "left",
				stack: null,
				values: entries.map((entry) => entry.average),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildWeekdayCurveCard(input: CardInput): CardModel {
	const { context } = input;
	const days = dayRowsOf(input);
	const average = weekAverage(input);
	const entries = curveDays(input, days, average);
	const weekNet = entries.some((entry) => entry.net !== null)
		? entries.reduce<number>(
				(total, entry) =>
					entry.net === null ? total : total + Math.round(entry.net * 100),
				0,
			) / 100
		: null;
	const best = strongestDay(entries);
	const share = best === null ? null : ratio(best.net, weekNet, SHARE_DIGITS);
	const values: Record<string, TypedValue> = { period: weekValue(context) };
	if (best !== null && best.net !== null) {
		values.weekday = weekdayValue(best.date);
		values.value = numberValue("money", best.net);
		values.share = numberValue("percent", share ?? 0);
	}
	const parts = narrate({
		main: {
			up: weekKeys.curve.main,
			down: weekKeys.curve.main,
			flat: weekKeys.curve.main,
			noReference: weekKeys.curve.main,
			noData: weekKeys.curve.noData,
		},
		values,
		current: best?.net ?? null,
		comparison: null,
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const driver = best === null ? null : driverPart(entries);
	const averageLabel =
		average.basis === "like_for_like"
			? weekKeys.table.weekdayAverageLikeForLike
			: weekKeys.table.weekdayAverage;
	return {
		id: "weekday_curve",
		titleKey: weekKeys.curve.title,
		subtitle: null,
		metricId: "weekday_net",
		relatedMetricIds: ["weekday_share"],
		headline: {
			value: best?.net ?? null,
			unit: "money",
			caption:
				best === null
					? null
					: part(weekKeys.curve.caption, {
							weekday: weekdayValue(best.date),
							date: textValue("date", best.date),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: driver === null ? parts : [...parts, driver].slice(0, 3),
		tables: [
			tableModel({
				captionKey: weekKeys.curve.table,
				columns: [
					column("weekday", reportKeys.table.weekday, "weekday"),
					column("date", reportKeys.table.date, "date"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", weekKeys.table.shareOfWeek, "percent"),
					column("lastWeek", weekKeys.table.lastWeek, "money"),
					column(
						"changeLastWeek",
						weekKeys.table.changeLastWeek,
						"signedPercent",
					),
					column("average", averageLabel, "money"),
					column(
						"changeAverage",
						weekKeys.table.changeWeekdayAverage,
						"signedPercent",
					),
				],
				rows: entries.map((entry) => ({
					id: entry.date,
					cells: {
						weekday: entry.weekday,
						date: entry.date,
						net: entry.net,
						share:
							entry.net === null
								? null
								: ratio(entry.net, weekNet, SHARE_DIGITS),
						lastWeek: entry.lastWeek,
						changeLastWeek: relativeChange(entry.net, entry.lastWeek),
						average: entry.average,
						changeAverage: relativeChange(entry.coveredNet, entry.average),
					},
				})),
			}),
		],
		chart: chartOf(entries, average),
		notice: best === null ? noDataNotice() : null,
		markers: weekMarkers(input, false),
		csvName: weekCsvName(context, "weekday_curve"),
	};
}

export const weekdayCurveCard: CardDefinition = {
	id: "weekday_curve",
	needs: weekNeeds.curve,
	visible: () => true,
	build: buildWeekdayCurveCard,
};
