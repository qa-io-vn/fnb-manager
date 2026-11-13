import {
	type CardDefinition,
	type CardInput,
	storeIdsOf,
} from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { noCoverageReason } from "../../../model/comparison.js";
import { reportKeys, unavailableKey } from "../../../model/keys.js";
import { FLAT_THRESHOLD } from "../../../model/narrative.js";
import { column, tableModel } from "../../../model/tables.js";
import { youngStoreNote } from "../../../model/totals.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import { addYears, monthOf } from "../../../period/dates.js";
import { yearKeys } from "../keys.js";
import {
	completeMonthsOfYear,
	type MonthGrowth,
	monthGrowth,
	monthOnMonth,
	type SeriesIndex,
	tetMonth,
	threeMonthChange,
	type YearBounds,
} from "../rules.js";
import {
	boundsOf,
	historyStartOf,
	monthIndex,
	monthOfYearValue,
	monthValue,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

const TET_LEADING_MONTHS: readonly number[] = [1, 2];

export interface GrowthRow extends MonthGrowth {
	readonly monthOnMonth: number | null;
	readonly threeMonths: number | null;
}

export function growthRows(input: CardInput): GrowthRow[] {
	const bounds = boundsOf(input.context);
	const months = monthIndex(input);
	const storeIds = storeIdsOf(input.context);
	const historyStart = historyStartOf(input.coverage);
	const complete = completeMonthsOfYear(
		bounds.year,
		bounds.asOf,
		bounds.yearEnd,
	);
	return complete.map((month, index) => ({
		...monthGrowth(months, month, storeIds, historyStart),
		monthOnMonth: monthOnMonth(months, month),
		threeMonths:
			index === complete.length - 1 ? threeMonthChange(months, month) : null,
	}));
}

interface Extremes {
	readonly rise: GrowthRow | null;
	readonly fall: GrowthRow | null;
}

export function growthExtremes(rows: readonly GrowthRow[]): Extremes {
	let rise: GrowthRow | null = null;
	let fall: GrowthRow | null = null;
	for (const row of rows) {
		if (row.yoy === null) continue;
		if (
			row.yoy >= FLAT_THRESHOLD &&
			(rise === null || row.yoy > (rise.yoy ?? 0))
		)
			rise = row;
		if (
			row.yoy <= -FLAT_THRESHOLD &&
			(fall === null || row.yoy < (fall.yoy ?? 0))
		)
			fall = row;
	}
	return { rise, fall };
}

function mainSentence(
	rows: readonly GrowthRow[],
	extremes: Extremes,
	bounds: YearBounds,
): SentencePart {
	if (rows.length === 0) {
		return part(yearKeys.growth.noData, { year: yearValue(bounds) });
	}
	if (rows.every((row) => row.yoy === null)) {
		return part(yearKeys.growth.noReference);
	}
	const { rise, fall } = extremes;
	const riseValues =
		rise === null
			? {}
			: {
					rise: monthValue(rise.month),
					riseDelta: numberValue("signedPercent", rise.yoy ?? 0),
				};
	const fallValues =
		fall === null
			? {}
			: {
					fall: monthValue(fall.month),
					fallDelta: numberValue("signedPercent", fall.yoy ?? 0),
				};
	if (rise !== null && fall !== null) {
		return part(yearKeys.growth.main, { ...riseValues, ...fallValues });
	}
	if (rise !== null) return part(yearKeys.growth.onlyRise, riseValues);
	if (fall !== null) return part(yearKeys.growth.onlyFall, fallValues);
	return part(yearKeys.growth.flat);
}

function likeForLikeNote(
	rows: readonly GrowthRow[],
	storeCount: number,
): SentencePart | null {
	const latest = [...rows]
		.reverse()
		.find((row) => row.basis === "like_for_like" && row.yoy !== null);
	if (latest === undefined) return null;
	return part(reportKeys.clause.coverage.likeForLike, {
		covered: numberValue("count", latest.coveredStoreIds.length),
		total: numberValue("count", storeCount),
	});
}

export function tetShiftNote(
	months: SeriesIndex,
	extremes: Extremes,
	bounds: YearBounds,
): SentencePart | null {
	const leads = [extremes.rise, extremes.fall].some(
		(row) => row !== null && TET_LEADING_MONTHS.includes(monthOf(row.month)),
	);
	if (!leads) return null;
	const thisYear = tetMonth(months, bounds.year);
	const lastYear = tetMonth(months, bounds.year - 1);
	if (thisYear === null || lastYear === null) return null;
	if (monthOf(thisYear) === monthOf(lastYear)) return null;
	return part(reportKeys.clause.tet.shift, {
		month: monthValue(thisYear),
		otherMonth: monthValue(lastYear),
	});
}

function stateOf(input: CardInput, row: GrowthRow): string | null {
	if (row.basis === "like_for_like") return yearKeys.table.likeForLike;
	if (row.basis === "all_stores") return null;
	return unavailableKey(
		noCoverageReason(
			input.coverage,
			storeIdsOf(input.context),
			addYears(row.month, -1),
		),
		"last_year",
	);
}

function growthTable(input: CardInput, rows: readonly GrowthRow[]): TableModel {
	const withState = rows.some((row) => row.basis !== "all_stores");
	const withCovered = rows.some((row) => row.basis === "like_for_like");
	const covered = (row: GrowthRow, value: number | null) =>
		row.basis === "like_for_like" ? value : null;
	const columns: TableColumnModel[] = [
		column("month", reportKeys.table.month, "month"),
		column("net", reportKeys.table.netAmount, "money"),
		column("lastYear", yearKeys.table.lastYearNet, "money"),
		...(withCovered
			? [
					column("coveredNet", yearKeys.table.coveredNet, "money"),
					column("coveredLastYear", yearKeys.table.coveredLastYearNet, "money"),
				]
			: []),
		column("yoy", yearKeys.table.yoy, "signedPercent"),
		...(withState ? [column("state", reportKeys.table.state, "message")] : []),
		column("mom", yearKeys.table.mom, "signedPercent"),
		column("threeMonths", yearKeys.table.threeMonths, "signedPercent"),
	];
	return tableModel({
		captionKey: yearKeys.growth.table,
		columns,
		rows: rows.map((row) => ({
			id: row.month,
			cells: {
				month: row.month.slice(0, 7),
				net: row.net,
				lastYear: row.lastYearNet,
				coveredNet: covered(row, row.coveredNet),
				coveredLastYear: covered(row, row.coveredLastYearNet),
				yoy: row.yoy,
				state: stateOf(input, row),
				mom: row.monthOnMonth,
				threeMonths: row.threeMonths,
			},
		})),
	});
}

function growthChart(rows: readonly GrowthRow[]): ChartModel | null {
	if (rows.every((row) => row.yoy === null)) return null;
	return {
		labelKey: yearKeys.growth.chart,
		categories: rows.map((row) => monthOfYearValue(row.month)),
		series: [
			{
				label: part(yearKeys.growth.rise),
				kind: "bar",
				tone: "positive",
				axis: "left",
				stack: "yoy",
				values: rows.map((row) =>
					row.yoy !== null && row.yoy >= 0 ? row.yoy : null,
				),
			},
			{
				label: part(yearKeys.growth.fall),
				kind: "bar",
				tone: "negative",
				axis: "left",
				stack: "yoy",
				values: rows.map((row) =>
					row.yoy !== null && row.yoy < 0 ? row.yoy : null,
				),
			},
		],
		leftUnit: "signedFraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function growthNotice(
	input: CardInput,
	rows: readonly GrowthRow[],
	bounds: YearBounds,
): NoticeModel | null {
	const latest = rows.at(-1);
	if (latest === undefined) {
		return {
			tone: "info",
			part: part(yearKeys.growth.noCompleteMonth, { year: yearValue(bounds) }),
			action: null,
		};
	}
	if (latest.yoy !== null) return null;
	if (rows.every((row) => row.net === null)) {
		return {
			tone: "info",
			part: part(yearKeys.noSales, { year: yearValue(bounds) }),
			action: null,
		};
	}
	const young =
		latest.basis === "none"
			? youngStoreNote(
					input.context,
					input.coverage,
					addYears(latest.month, -1),
				)
			: null;
	return {
		tone: "info",
		part: young ?? part(yearKeys.growth.noReference),
		action: null,
	};
}

export function buildGrowthCard(input: CardInput): CardModel {
	const { context } = input;
	const bounds = boundsOf(context);
	const months = monthIndex(input);
	const rows = growthRows(input);
	const latest = rows.at(-1) ?? null;
	const extremes = growthExtremes(rows);
	const notes = [
		likeForLikeNote(rows, context.stores.length),
		tetShiftNote(months, extremes, bounds),
	].filter((note): note is SentencePart => note !== null);
	return {
		id: "growth",
		titleKey: yearKeys.growth.title,
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: [],
		headline: {
			value: latest?.yoy ?? null,
			unit: "signedFraction",
			caption:
				latest === null || latest.yoy === null
					? null
					: part(yearKeys.growth.caption, { month: monthValue(latest.month) }),
		},
		comparisons: [],
		decomposition: null,
		narrative: [mainSentence(rows, extremes, bounds), ...notes].slice(0, 3),
		tables: [growthTable(input, rows)],
		chart: growthChart(rows),
		notice: growthNotice(input, rows, bounds),
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "growth"),
	};
}

export const growthCard: CardDefinition = {
	id: "growth",
	needs: yearNeeds.growth,
	visible: () => true,
	build: buildGrowthCard,
};
