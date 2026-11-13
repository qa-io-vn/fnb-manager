import {
	type CardDefinition,
	type CardInput,
	storeIdsOf,
} from "../../../definition.js";
import type {
	CardModel,
	ChartMarkArea,
	ChartModel,
	TableModel,
} from "../../../model/card.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { yearKeys } from "../keys.js";
import {
	extremeIndex,
	hasData,
	isoWeekCount,
	latestCompleteMonth,
	type Seasonality,
	type SeriesRow,
	seasonality,
	type TetDip,
	tetDip,
	tetWeekRange,
	weeklyNet,
	type YearBounds,
} from "../rules.js";
import {
	boundsOf,
	historyStartOf,
	lastYearValue,
	monthIndex,
	monthValue,
	weekdayRows,
	weekRows,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

export function seasonalityOf(input: CardInput): Seasonality {
	const bounds = boundsOf(input.context);
	return seasonality(
		monthIndex(input),
		latestCompleteMonth(bounds.yearEnd, bounds.asOf),
		storeIdsOf(input.context),
		historyStartOf(input.coverage),
	);
}

function indexSentence(season: Seasonality): SentencePart {
	const peak = season.complete ? extremeIndex(season.months, "highest") : null;
	const low = season.complete ? extremeIndex(season.months, "lowest") : null;
	if (
		peak === null ||
		low === null ||
		peak.index === null ||
		low.index === null
	) {
		return part(yearKeys.seasonality.tooShortSentence);
	}
	return part(yearKeys.seasonality.main, {
		month: monthValue(peak.month),
		index: numberValue("ratio", peak.index),
		lowMonth: monthValue(low.month),
		lowIndex: numberValue("ratio", low.index),
	});
}

function dipSentence(
	thisYear: TetDip | null,
	lastYear: TetDip | null,
	bounds: YearBounds,
): SentencePart | null {
	const year = yearValue(bounds);
	const previous = lastYearValue(bounds);
	if (thisYear !== null && lastYear !== null) {
		return part(yearKeys.seasonality.tetBoth, {
			year,
			dip: numberValue("signedPercent", thisYear.dip),
			lastYear: previous,
			lastDip: numberValue("signedPercent", lastYear.dip),
		});
	}
	if (thisYear !== null) {
		return part(yearKeys.seasonality.tetThisYear, {
			year,
			dip: numberValue("signedPercent", thisYear.dip),
		});
	}
	if (lastYear !== null) {
		return part(yearKeys.seasonality.tetLastYear, {
			lastYear: previous,
			lastDip: numberValue("signedPercent", lastYear.dip),
		});
	}
	return null;
}

function monthlyTable(season: Seasonality): TableModel {
	return tableModel({
		captionKey:
			season.basis === "like_for_like"
				? yearKeys.seasonality.tableLikeForLike
				: yearKeys.seasonality.table,
		columns: [
			column("month", reportKeys.table.month, "month"),
			column("net", reportKeys.table.netAmount, "money"),
			column("days", reportKeys.table.days, "count"),
			column("avgDaily", yearKeys.table.avgDailyNet, "money"),
			column("index", yearKeys.table.index, "ratio"),
		],
		rows: season.months.map((entry) => ({
			id: entry.month,
			cells: {
				month: entry.month.slice(0, 7),
				net: entry.net,
				days: entry.calendarDays,
				avgDaily: entry.avgDailyNet,
				index: entry.index,
			},
		})),
	});
}

export function weekdayTable(rows: readonly SeriesRow[]): TableModel {
	const nets = rows.map((row) => (hasData(row) ? row.net_amount : null));
	const total = sumMoney(nets);
	return tableModel({
		captionKey: yearKeys.seasonality.weekdayTable,
		columns: [
			column("weekday", reportKeys.table.weekday, "weekday"),
			column("net", reportKeys.table.netAmount, "money"),
			column("share", reportKeys.table.share, "percent"),
		],
		rows: rows.map((row, index) => ({
			id: String(row.weekday ?? index + 1),
			cells: {
				weekday: row.weekday,
				net: nets[index] ?? null,
				share: ratio(nets[index] ?? null, total, SHARE_DIGITS),
			},
		})),
	});
}

export function weeklyChart(
	weeks: readonly SeriesRow[],
	bounds: YearBounds,
): ChartModel | null {
	const years = [bounds.year, bounds.year - 1];
	const weekCount = isoWeekCount(years);
	const [current, previous] = years.map((year) =>
		weeklyNet(weeks, year, weekCount),
	);
	if (current === undefined || previous === undefined) return null;
	if ([...current, ...previous].every((value) => value === null)) return null;
	const markAreas: ChartMarkArea[] = years.flatMap((year) => {
		const range = tetWeekRange(weeks, year);
		return range === null
			? []
			: [
					{
						label: part(yearKeys.seasonality.tet, {
							year: textValue("year", String(year)),
						}),
						fromIndex: range.from - 1,
						toIndex: Math.min(range.to, weekCount) - 1,
					},
				];
	});
	return {
		labelKey: yearKeys.seasonality.chart,
		categories: Array.from({ length: weekCount }, (_, offset) =>
			numberValue("count", offset + 1),
		),
		series: [
			{
				label: part(yearKeys.seasonality.series, { year: yearValue(bounds) }),
				kind: "line",
				tone: "primary",
				axis: "left",
				stack: null,
				values: current,
			},
			{
				label: part(yearKeys.seasonality.series, {
					year: lastYearValue(bounds),
				}),
				kind: "line",
				tone: "muted",
				axis: "left",
				stack: null,
				values: previous,
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas,
	};
}

export function buildSeasonalityCard(input: CardInput): CardModel {
	const { context } = input;
	const bounds = boundsOf(context);
	const season = seasonalityOf(input);
	const peak = season.complete ? extremeIndex(season.months, "highest") : null;
	const weeks = weekRows(input);
	const dips = dipSentence(
		tetDip(weeks, bounds.year),
		tetDip(weeks, bounds.year - 1),
		bounds,
	);
	const weekday = weekdayTable(weekdayRows(input));
	return {
		id: "seasonality",
		titleKey: yearKeys.seasonality.title,
		subtitle: null,
		metricId: "seasonality_index",
		relatedMetricIds: ["weekday_share"],
		headline: {
			value: peak?.index ?? null,
			unit: "ratio",
			caption:
				peak === null
					? null
					: part(yearKeys.seasonality.caption, {
							month: monthValue(peak.month),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [indexSentence(season), ...(dips === null ? [] : [dips])],
		tables: season.complete ? [monthlyTable(season), weekday] : [weekday],
		chart: weeklyChart(weeks, bounds),
		notice: season.complete
			? null
			: {
					tone: "info",
					part: part(yearKeys.seasonality.tooShort),
					action: null,
				},
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "seasonality"),
	};
}

export const seasonalityCard: CardDefinition = {
	id: "seasonality",
	needs: yearNeeds.seasonality,
	visible: () => true,
	build: buildSeasonalityCard,
};
