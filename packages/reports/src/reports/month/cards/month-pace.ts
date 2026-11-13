import type { CardDefinition, CardInput } from "../../../definition.js";
import {
	type CardModel,
	type ChartMarkLine,
	type ChartModel,
	type Comparison,
	type Decomposition,
	MAX_NARRATIVE_PARTS,
	type NoticeModel,
	type TableColumnModel,
	type TableModel,
	type TableRowModel,
} from "../../../model/card.js";
import { comparisonsFromPeriodRows } from "../../../model/comparison.js";
import {
	decomposeNet,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import {
	decompositionClause,
	decompositionReferenceClause,
	likeForLikeNote,
	mainClauseOf,
	narrate,
} from "../../../model/narrative.js";
import { column, tableModel } from "../../../model/tables.js";
import { decompositionInputs, youngStoreNote } from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { datesBetween } from "../../../period/dates.js";
import {
	accuracyOf,
	coveredComparison,
	type ForecastMethod,
	forecastLabel,
	forecastLabelKeys,
	forecastOf,
	forecastOrder,
	forecastRowKeys,
} from "../forecasts.js";
import { monthKeys } from "../keys.js";
import {
	accuracyRows,
	compareRows,
	comparisonOf,
	coveredPaceRow,
	likeForLikeTotals,
	type MonthRanges,
	monthCalls,
	monthCsvName,
	monthLabels,
	monthMarkers,
	monthNeeds,
	monthRanges,
	monthValue,
	paceRow,
	pickFrom,
	type SeriesRow,
	seriesRows,
	totalsOf,
} from "../support.js";
import { monthTargets } from "../targets.js";

export function monthNet(
	rows: readonly SeriesRow[],
	storeId: string | null,
	bucketStart: string,
): number | null {
	const row = rows.find(
		(entry) => entry.store_id === storeId && entry.bucket_start === bucketStart,
	);
	return row === undefined || row.days_with_data === 0 ? null : row.net_amount;
}

export function forecastComparisons(
	input: CardInput,
	ranges: MonthRanges,
	order: readonly ForecastMethod[],
): readonly Comparison[] {
	const months = seriesRows(input, monthCalls.months);
	const pace = paceRow(input);
	return order.map((method) =>
		coveredComparison({
			kind: "forecast",
			label: forecastLabel(method),
			reference: {
				coverage: input.coverage,
				from: ranges.previousStart,
				to: ranges.previousMonthEnd,
				all: {
					current: forecastOf(pace, method),
					reference: monthNet(months, null, ranges.previousStart),
				},
				perStore: (storeId) => ({
					current: forecastOf(coveredPaceRow(input, storeId), method),
					reference: monthNet(months, storeId, ranges.previousStart),
				}),
			},
			missingCurrent: "building_baseline",
		}),
	);
}

function forecastClause(
	input: CardInput,
	order: readonly ForecastMethod[],
	comparisons: readonly Comparison[],
): SentencePart | null {
	const pace = paceRow(input);
	for (const [index, method] of order.entries()) {
		const value = forecastOf(pace, method);
		if (value === null) continue;
		const versus = comparisons[index];
		const values: Record<string, TypedValue> = {
			method: messageValue(forecastLabelKeys[method]),
			value: numberValue("money", value),
		};
		if (
			versus !== undefined &&
			versus.basis === "all_stores" &&
			versus.unavailable === null &&
			versus.change !== null
		) {
			return part(monthKeys.pace.forecast, {
				...values,
				delta: numberValue("signedPercent", versus.change),
			});
		}
		return part(monthKeys.pace.forecastOnly, values);
	}
	return null;
}

function closedDecompositionClause(
	split: Decomposition | null,
	clause: ReturnType<typeof mainClauseOf>,
	comparisons: readonly Comparison[],
): SentencePart | null {
	if (split === null) return null;
	if (split.against === "previous") {
		return clause === "up" || clause === "down"
			? decompositionClause(split)
			: null;
	}
	return decompositionReferenceClause(
		split,
		comparisons.find(
			(entry) =>
				entry.kind === split.against &&
				entry.basis === split.basis &&
				entry.unavailable === null,
		) ?? null,
	);
}

function closedNarrative(
	values: Readonly<Record<string, TypedValue>>,
	current: number | null,
	comparisons: readonly Comparison[],
	note: SentencePart | null,
	split: Decomposition | null,
): readonly SentencePart[] {
	if (current === null) return [part(monthKeys.pace.noData, values)];
	const previous = comparisonOf(comparisons, "previous");
	const parts: SentencePart[] = [part(monthKeys.pace.closed, values)];
	const clause = mainClauseOf(current, previous);
	if ((clause === "up" || clause === "down") && previous?.change != null) {
		parts.push(
			part(
				clause === "up" ? monthKeys.pace.closedUp : monthKeys.pace.closedDown,
				{ delta: numberValue("percent", Math.abs(previous.change)) },
			),
		);
	} else if (clause === "flat") {
		parts.push(part(monthKeys.pace.closedFlat));
	}
	const coverage =
		clause === "up" || clause === "down" || clause === "flat"
			? likeForLikeNote(previous, "money")
			: null;
	const follow =
		coverage ?? note ?? closedDecompositionClause(split, clause, comparisons);
	if (follow !== null) parts.push(follow);
	return parts.slice(0, MAX_NARRATIVE_PARTS);
}

function paceTable(
	input: CardInput,
	ranges: MonthRanges,
	order: readonly ForecastMethod[],
	open: boolean,
): TableModel {
	const rows = compareRows(input);
	const pace = paceRow(input);
	const accuracy = accuracyRows(input);
	const months = seriesRows(input, monthCalls.months);
	const target = monthTargets(input).total;
	const net = (period: "current" | "previous" | "last_year") =>
		pickFrom(totalsOf(rows, null, period), (row) => row.net_amount);
	const rangeOf = (period: "previous" | "last_year") => {
		const row = totalsOf(rows, null, period);
		return period === "previous"
			? {
					from: row?.from_date ?? ranges.previousStart,
					to: row?.to_date ?? ranges.previousEnd,
				}
			: {
					from: row?.from_date ?? ranges.lastYearStart,
					to: row?.to_date ?? ranges.lastYearEnd,
				};
	};
	const plain = (
		id: string,
		labelKey: string,
		from: string,
		to: string,
		value: number | null,
	): TableRowModel => ({
		id,
		cells: {
			row: labelKey,
			from,
			to,
			value,
			mae: null,
			mape: null,
			sampleDays: null,
		},
	});
	const tableRows: TableRowModel[] = [
		plain(
			"month_to_date",
			monthKeys.pace.row.monthToDate,
			ranges.monthStart,
			ranges.end,
			net("current"),
		),
		plain(
			"previous_same_days",
			monthKeys.pace.row.previousSameDays,
			rangeOf("previous").from,
			rangeOf("previous").to,
			net("previous"),
		),
		plain(
			"last_year_same_days",
			monthKeys.pace.row.lastYearSameDays,
			rangeOf("last_year").from,
			rangeOf("last_year").to,
			net("last_year"),
		),
		plain(
			"previous_month",
			monthKeys.pace.row.previousMonth,
			ranges.previousStart,
			ranges.previousMonthEnd,
			monthNet(months, null, ranges.previousStart),
		),
	];
	if (open) {
		for (const method of order) {
			const scored = accuracyOf(accuracy, method);
			tableRows.push({
				id: method,
				cells: {
					row: forecastRowKeys[method],
					from: ranges.monthStart,
					to: ranges.monthEnd,
					value: forecastOf(pace, method),
					mae: scored?.mae ?? null,
					mape: scored?.mape ?? null,
					sampleDays: scored?.sample_days ?? null,
				},
			});
		}
	}
	if (target !== null) {
		tableRows.push(
			plain(
				"target",
				monthKeys.pace.row.target,
				ranges.monthStart,
				ranges.monthEnd,
				target,
			),
		);
	}
	const columns: TableColumnModel[] = [
		column("row", reportKeys.table.period, "message"),
		column("from", reportKeys.table.from, "date"),
		column("to", reportKeys.table.to, "date"),
		column("value", reportKeys.table.netAmount, "money"),
		...(open
			? [
					column("mae", monthKeys.table.mae, "money"),
					column("mape", monthKeys.table.mape, "percent"),
					column("sampleDays", monthKeys.table.sampleDays, "count"),
				]
			: []),
	];
	return tableModel({
		captionKey: monthKeys.pace.table,
		columns,
		rows: tableRows,
	});
}

function paceChart(
	input: CardInput,
	ranges: MonthRanges,
	order: readonly ForecastMethod[],
	open: boolean,
): ChartModel {
	const pace = paceRow(input);
	const dayNet = new Map(
		seriesRows(input, monthCalls.days)
			.filter((row) => row.store_id === null && row.days_with_data > 0)
			.map((row) => [row.bucket_start, row.net_amount]),
	);
	const dates = datesBetween(ranges.monthStart, ranges.monthEnd);
	let running = 0;
	const cumulative = dates.map((date) => {
		if (date > ranges.end) return null;
		running = sumMoney([running, dayNet.get(date) ?? 0]);
		return running;
	});
	const markLines: ChartMarkLine[] = [];
	if (open) {
		for (const method of order) {
			const value = forecastOf(pace, method);
			if (value !== null) {
				markLines.push({ label: forecastLabel(method), value, axis: "left" });
			}
		}
	}
	const target = monthTargets(input).total;
	if (target !== null) {
		markLines.push({
			label: part(monthKeys.pace.targetLine),
			value: target,
			axis: "left",
		});
	}
	return {
		labelKey: monthKeys.pace.chart,
		categories: dates.map((date) => textValue("date", date)),
		series: [
			{
				label: part(monthKeys.pace.cumulative),
				kind: "line",
				tone: "primary",
				axis: "left",
				stack: null,
				values: cumulative,
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines,
		markAreas: [],
	};
}

export function buildMonthPaceCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const ranges = monthRanges(context);
	const rows = compareRows(input);
	const open = !context.period.complete;
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.net_amount,
	);
	const periodComparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["previous", "last_year"],
		pick: (row) => row.net_amount,
		labels: monthLabels(),
	});
	const order = forecastOrder(accuracyRows(input));
	const forecasts = open ? forecastComparisons(input, ranges, order) : [];
	const against = decompositionAgainst(periodComparisons);
	const inputs =
		against === null ? null : decompositionInputs(rows, coverage, against);
	const split =
		against === null || inputs === null
			? null
			: decomposition(
					"net_revenue",
					against.kind === "previous" ? "previous" : "last_year",
					against.basis,
					decomposeNet(inputs.current, inputs.reference),
				);
	const values: Record<string, TypedValue> = {
		month: monthValue(context),
		end: textValue("date", ranges.end),
	};
	if (current !== null) values.value = numberValue("money", current);
	const note = youngStoreNote(context, coverage, ranges.lastYearStart);
	const previous = comparisonOf(periodComparisons, "previous");
	const parts = open
		? narrate({
				main: {
					up: monthKeys.pace.up,
					down: monthKeys.pace.down,
					flat: monthKeys.pace.flat,
					noReference: monthKeys.pace.noReference,
					noData: monthKeys.pace.noData,
				},
				values,
				current,
				comparison: previous,
				notes: note === null ? [] : [note],
				drivers: [],
				decomposition: null,
			})
		: closedNarrative(values, current, periodComparisons, note, split);
	const clause = open ? forecastClause(input, order, forecasts) : null;
	const pace = paceRow(input);
	const notice: NoticeModel | null =
		open && order.every((method) => forecastOf(pace, method) === null)
			? { tone: "info", part: part(monthKeys.pace.noForecast), action: null }
			: null;
	return {
		id: "month_pace",
		titleKey: monthKeys.pace.title,
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: [
			"forecast_weekday_profile",
			"forecast_seasonal_naive",
			"forecast_mae",
		],
		headline: { value: current, unit: "money", caption: null },
		comparisons: [...periodComparisons, ...forecasts],
		decomposition: split,
		narrative: clause === null ? parts : [...parts, clause].slice(0, 3),
		tables: [paceTable(input, ranges, order, open)],
		chart: current === null ? null : paceChart(input, ranges, order, open),
		notice,
		markers: monthMarkers(input, false),
		csvName: monthCsvName(context, "month_pace"),
	};
}

export const monthPaceCard: CardDefinition = {
	id: "month_pace",
	needs: monthNeeds.pace,
	visible: () => true,
	build: buildMonthPaceCard,
};
