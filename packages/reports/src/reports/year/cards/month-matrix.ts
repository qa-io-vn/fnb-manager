import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import type { Coverage } from "../../../model/coverage.js";
import { sumMoneyOrNull } from "../../../model/money.js";
import { FLAT_THRESHOLD } from "../../../model/narrative.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import { youngStoreNote } from "../../../model/totals.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import { firstOfMonth } from "../../../period/dates.js";
import { monthLabelKey, YEAR_MONTH_NUMBERS, yearKeys } from "../keys.js";
import {
	coveredSeries,
	hasData,
	isCompleteMonth,
	MATRIX_YEARS,
	monthStartOf,
	type PeakMonth,
	peakMonth,
	type SeriesIndex,
	type YearBounds,
} from "../rules.js";
import {
	boundsOf,
	lastYearValue,
	monthIndex,
	monthValue,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

export function matrixColumnKey(month: number): string {
	return `m${String(month).padStart(2, "0")}`;
}

export const MATRIX_HEAT_COLUMNS: readonly string[] =
	YEAR_MONTH_NUMBERS.map(matrixColumnKey);

function matrixYears(bounds: YearBounds): number[] {
	return Array.from(
		{ length: MATRIX_YEARS },
		(_, offset) => bounds.year - MATRIX_YEARS + 1 + offset,
	);
}

export function matrixTable(
	months: SeriesIndex,
	bounds: YearBounds,
): TableModel {
	const columns: TableColumnModel[] = [
		column("year", yearKeys.table.year, "text"),
		...YEAR_MONTH_NUMBERS.map((month) =>
			column(matrixColumnKey(month), monthLabelKey(month), "money"),
		),
		column("total", yearKeys.table.total, "money"),
	];
	const rows = matrixYears(bounds).map((year) => {
		const nets = YEAR_MONTH_NUMBERS.map((month) => {
			const row = months.all(monthStartOf(year, month));
			return hasData(row) ? row.net_amount : null;
		});
		const cells: Record<string, string | number | null> = {
			year: String(year),
			total: sumMoneyOrNull(nets),
		};
		YEAR_MONTH_NUMBERS.forEach((month, index) => {
			cells[matrixColumnKey(month)] = nets[index] ?? null;
		});
		return { id: String(year), cells };
	});
	const currentMonthComplete = isCompleteMonth(
		firstOfMonth(bounds.yearEnd),
		bounds.asOf,
	);
	return tableModel({
		captionKey: currentMonthComplete
			? yearKeys.matrix.table
			: yearKeys.matrix.partial,
		columns,
		rows,
		variant: "heat",
		heatColumns: MATRIX_HEAT_COLUMNS,
	});
}

function peakSentence(
	peak: PeakMonth | null,
	bounds: YearBounds,
): SentencePart {
	if (peak === null) {
		return part(yearKeys.matrix.noData, { year: yearValue(bounds) });
	}
	return part(
		peak.partial ? yearKeys.matrix.peakPartial : yearKeys.matrix.peak,
		{
			year: yearValue(bounds),
			month: monthValue(peak.month),
			value: numberValue("money", peak.net),
		},
	);
}

function lastYearSentence(
	peak: PeakMonth | null,
	lastPeak: PeakMonth | null,
	bounds: YearBounds,
): SentencePart | null {
	if (peak === null) return null;
	if (lastPeak === null) {
		return part(yearKeys.matrix.lastYearNone, {
			lastYear: lastYearValue(bounds),
		});
	}
	const change = relativeChange(peak.net, lastPeak.net);
	const values = {
		lastYear: lastYearValue(bounds),
		month: monthValue(lastPeak.month),
		value: numberValue("money", lastPeak.net),
	};
	if (change === null || Math.abs(change) < FLAT_THRESHOLD) {
		return part(yearKeys.matrix.lastYearFlat, values);
	}
	return part(
		change > 0 ? yearKeys.matrix.lastYearUp : yearKeys.matrix.lastYearDown,
		{ ...values, delta: numberValue("percent", Math.abs(change)) },
	);
}

function likeForLikeSentence(
	months: SeriesIndex,
	covered: Coverage,
	bounds: YearBounds,
): SentencePart | null {
	const series = coveredSeries(months, covered.coveredStoreIds);
	const peak = peakMonth(series, bounds.year, bounds.asOf);
	const lastPeak = peakMonth(series, bounds.year - 1, bounds.asOf);
	if (peak === null || lastPeak === null) return null;
	const change = relativeChange(peak.net, lastPeak.net);
	const values = {
		covered: numberValue("count", covered.coveredStoreIds.length),
		total: numberValue("count", covered.storeCount),
		lastYear: lastYearValue(bounds),
		month: monthValue(lastPeak.month),
		value: numberValue("money", lastPeak.net),
		currentMonth: monthValue(peak.month),
		currentValue: numberValue("money", peak.net),
	};
	if (change === null || Math.abs(change) < FLAT_THRESHOLD) {
		return part(yearKeys.matrix.lastYearFlatLikeForLike, values);
	}
	return part(
		change > 0
			? yearKeys.matrix.lastYearUpLikeForLike
			: yearKeys.matrix.lastYearDownLikeForLike,
		{ ...values, delta: numberValue("percent", Math.abs(change)) },
	);
}

export function buildMonthMatrixCard(input: CardInput): CardModel {
	const { context } = input;
	const bounds = boundsOf(context);
	const months = monthIndex(input);
	const peak = peakMonth(months, bounds.year, bounds.asOf);
	const lastPeak = peakMonth(months, bounds.year - 1, bounds.asOf);
	const reference = input.coverage.forReference(bounds.lastYearStart);
	const partial = lastPeak !== null && reference.state === "partial";
	const second =
		peak !== null && partial
			? (likeForLikeSentence(months, reference, bounds) ??
				lastYearSentence(peak, lastPeak, bounds))
			: lastYearSentence(peak, lastPeak, bounds);
	const young = partial
		? youngStoreNote(context, input.coverage, bounds.lastYearStart)
		: null;
	const notice: NoticeModel | null =
		peak === null
			? {
					tone: "info",
					part: part(yearKeys.noSales, { year: yearValue(bounds) }),
					action: null,
				}
			: null;
	return {
		id: "month_matrix",
		titleKey: yearKeys.matrix.title,
		subtitle: null,
		metricId: "month_year_net",
		relatedMetricIds: [],
		headline: {
			value: peak?.net ?? null,
			unit: "money",
			caption:
				peak === null
					? null
					: part(
							peak.partial
								? yearKeys.matrix.captionPartial
								: yearKeys.matrix.caption,
							{ month: monthValue(peak.month) },
						),
		},
		comparisons: [],
		decomposition: null,
		narrative: [peakSentence(peak, bounds), second, young].filter(
			(sentence): sentence is SentencePart => sentence !== null,
		),
		tables: [matrixTable(months, bounds)],
		chart: null,
		notice,
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "month_matrix"),
	};
}

export const monthMatrixCard: CardDefinition = {
	id: "month_matrix",
	needs: yearNeeds.matrix,
	visible: () => true,
	build: buildMonthMatrixCard,
};
