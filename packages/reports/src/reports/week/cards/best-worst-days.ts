import type { AnalyticsRow } from "../../../contract/functions.js";
import type { HolidayKind, IsoDate } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, NoticeModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { isoWeekday } from "../../../period/dates.js";
import { weekKeys } from "../keys.js";
import {
	dayRowsOf,
	weekCalls,
	weekCsvName,
	weekDates,
	weekdayValue,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";

type BaselineRow = AnalyticsRow<"daily_baselines">;

export const MIN_COMPARED_DAYS = 2;

export interface DayDeviation {
	readonly date: IsoDate;
	readonly weekday: number;
	readonly net: number | null;
	readonly baseline: number | null;
	readonly sampleDays: number;
	readonly deviation: number | null;
	readonly holiday: HolidayKind | null;
}

export function dayDeviations(input: CardInput): DayDeviation[] {
	const days = dayRowsOf(input);
	const baselines = new Map(
		(input.results.rows(weekCalls.baselines, "daily_baselines") ?? []).map(
			(row: BaselineRow) => [row.business_date, row],
		),
	);
	return weekDates(input.context).map((date) => {
		const row = days.all(date);
		const net =
			row !== undefined && row.days_with_data > 0 ? row.net_amount : null;
		const baseline = baselines.get(date);
		const sampleDays = baseline?.sample_days ?? 0;
		const usual =
			sampleDays >= 1 ? (baseline?.baseline_net_amount ?? null) : null;
		return {
			date,
			weekday: isoWeekday(date),
			net,
			baseline: usual,
			sampleDays,
			deviation: relativeChange(net, usual),
			holiday: days.holidayKind(date),
		};
	});
}

export function bestAndWorst(
	entries: readonly DayDeviation[],
): { best: DayDeviation; worst: DayDeviation } | null {
	const compared = entries.filter((entry) => entry.deviation !== null);
	if (compared.length < MIN_COMPARED_DAYS) return null;
	let best = compared[0] as DayDeviation;
	let worst = best;
	for (const entry of compared.slice(1)) {
		if ((entry.deviation ?? 0) > (best.deviation ?? 0)) best = entry;
		if ((entry.deviation ?? 0) < (worst.deviation ?? 0)) worst = entry;
	}
	return { best, worst };
}

function holidayPart(entry: DayDeviation): SentencePart | null {
	if (entry.holiday === null) return null;
	return part(weekKeys.days.holiday, {
		weekday: weekdayValue(entry.date),
		date: textValue("date", entry.date),
		holiday: messageValue(reportKeys.holiday[entry.holiday]),
	});
}

function narrativeOf(
	input: CardInput,
	entries: readonly DayDeviation[],
	pair: { best: DayDeviation; worst: DayDeviation } | null,
): SentencePart[] {
	if (pair === null) {
		return [
			part(weekKeys.days.tooFewSentence, {
				count: numberValue(
					"count",
					entries.filter((entry) => entry.deviation !== null).length,
				),
				period: weekValue(input.context),
			}),
		];
	}
	const { best, worst } = pair;
	const notes = [
		holidayPart(best),
		...(worst.date === best.date ? [] : [holidayPart(worst)]),
	].filter((note): note is SentencePart => note !== null);
	return [
		part(weekKeys.days.main, {
			bestWeekday: weekdayValue(best.date),
			bestDate: textValue("date", best.date),
			bestDeviation: numberValue("signedPercent", best.deviation ?? 0),
			worstWeekday: weekdayValue(worst.date),
			worstDate: textValue("date", worst.date),
			worstDeviation: numberValue("signedPercent", worst.deviation ?? 0),
		}),
		...notes,
	].slice(0, 3);
}

export function buildBestWorstDaysCard(input: CardInput): CardModel {
	const { context } = input;
	const entries = dayDeviations(input);
	const pair = bestAndWorst(entries);
	const notice: NoticeModel | null =
		pair === null
			? {
					tone: "info",
					part: part(weekKeys.days.tooFew, {
						minimum: numberValue("count", MIN_COMPARED_DAYS),
					}),
					action: null,
				}
			: null;
	return {
		id: "best_worst_days",
		titleKey: weekKeys.days.title,
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: ["same_weekday_baseline"],
		headline: {
			value: pair?.best.deviation ?? null,
			unit: "signedFraction",
			caption:
				pair === null
					? null
					: part(weekKeys.days.caption, {
							weekday: weekdayValue(pair.best.date),
							date: textValue("date", pair.best.date),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(input, entries, pair),
		tables: [
			tableModel({
				captionKey: weekKeys.days.table,
				columns: [
					column("date", reportKeys.table.date, "date"),
					column("weekday", reportKeys.table.weekday, "weekday"),
					column("net", reportKeys.table.netAmount, "money"),
					column("baseline", reportKeys.table.baseline, "money"),
					column("deviation", weekKeys.table.deviation, "signedPercent"),
					column("holiday", weekKeys.table.holiday, "message"),
				],
				rows: entries.map((entry) => ({
					id: entry.date,
					cells: {
						date: entry.date,
						weekday: entry.weekday,
						net: entry.net,
						baseline: entry.baseline,
						deviation: entry.deviation,
						holiday:
							entry.holiday === null ? null : reportKeys.holiday[entry.holiday],
					},
				})),
			}),
		],
		chart:
			entries.length === 0
				? null
				: {
						labelKey: weekKeys.days.chart,
						categories: entries.map((entry) => weekdayValue(entry.date)),
						series: [
							{
								label: part(weekKeys.days.above),
								kind: "bar",
								tone: "positive",
								axis: "left",
								stack: "deviation",
								values: entries.map((entry) =>
									entry.deviation !== null && entry.deviation >= 0
										? entry.deviation
										: null,
								),
							},
							{
								label: part(weekKeys.days.below),
								kind: "bar",
								tone: "negative",
								axis: "left",
								stack: "deviation",
								values: entries.map((entry) =>
									entry.deviation !== null && entry.deviation < 0
										? entry.deviation
										: null,
								),
							},
						],
						leftUnit: "signedFraction",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice,
		markers: weekMarkers(input, false),
		csvName: weekCsvName(context, "best_worst_days"),
	};
}

export const bestWorstDaysCard: CardDefinition = {
	id: "best_worst_days",
	needs: weekNeeds.days,
	visible: () => true,
	build: buildBestWorstDaysCard,
};
