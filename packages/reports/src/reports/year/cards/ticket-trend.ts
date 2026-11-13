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
import {
	comparisonsFromPeriodRows,
	noCoverageReason,
} from "../../../model/comparison.js";
import {
	type DecompositionSums,
	decomposeTicket,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys, unavailableKey } from "../../../model/keys.js";
import { sumMoneyOrNull, sumQuantity } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { ratio, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	comparisonOf,
	decompositionInputs,
	likeForLikeTotals,
	pickFrom,
	totalsOf,
	youngStoreNote,
} from "../../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import { addYears } from "../../../period/dates.js";
import { YEAR_MONTH_NUMBERS, yearKeys } from "../keys.js";
import {
	basisOf,
	coveredAt,
	type GrowthBasis,
	hasData,
	MONEY_DIGITS,
	monthStartOf,
	type SeriesIndex,
	type YearBounds,
} from "../rules.js";
import {
	boundsOf,
	compareRows,
	historyStartOf,
	lastYearLabels,
	lastYearValue,
	monthIndex,
	monthOfYearValue,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

export function storeMonthSums(
	months: SeriesIndex,
	storeIds: readonly string[],
	month: string,
): DecompositionSums {
	const rows = storeIds.map((id) => months.store(id, month)).filter(hasData);
	if (rows.length === 0) return { net: null, invoices: null, items: null };
	return {
		net: sumMoneyOrNull(rows.map((row) => row.net_amount)),
		invoices: rows.reduce((total, row) => total + (row.invoices ?? 0), 0),
		items: sumQuantity(rows.map((row) => row.items_sold)),
	};
}

export interface TicketMonth {
	readonly month: string;
	readonly avgTicket: number | null;
	readonly itemsPerTicket: number | null;
	readonly avgItemPrice: number | null;
	readonly basis: GrowthBasis;
	readonly coveredTicket: number | null;
	readonly lastYearTicket: number | null;
	readonly change: number | null;
	readonly itemsEffect: number | null;
	readonly priceEffect: number | null;
}

export function ticketMonths(input: CardInput): TicketMonth[] {
	const bounds = boundsOf(input.context);
	const months = monthIndex(input);
	const storeIds = storeIdsOf(input.context);
	const historyStart = historyStartOf(input.coverage);
	return months
		.monthsOfYear(bounds.year)
		.filter(hasData)
		.map((row) => {
			const lastYearMonth = addYears(row.bucket_start, -1);
			const covered = coveredAt(storeIds, historyStart, lastYearMonth);
			const current = storeMonthSums(months, covered, row.bucket_start);
			const reference = storeMonthSums(months, covered, lastYearMonth);
			const coveredTicket = ratio(current.net, current.invoices, MONEY_DIGITS);
			const lastYearTicket = ratio(
				reference.net,
				reference.invoices,
				MONEY_DIGITS,
			);
			const split =
				covered.length === 0 ? null : decomposeTicket(current, reference);
			const effect = (factor: "items_per_ticket" | "avg_item_price") =>
				split?.parts.find((entry) => entry.factor === factor)?.effect ?? null;
			return {
				month: row.bucket_start,
				avgTicket: row.avg_ticket,
				itemsPerTicket: row.items_per_ticket,
				avgItemPrice: row.avg_item_price,
				basis: basisOf(covered.length, storeIds.length),
				coveredTicket,
				lastYearTicket,
				change: relativeChange(coveredTicket, lastYearTicket),
				itemsEffect: effect("items_per_ticket"),
				priceEffect: effect("avg_item_price"),
			};
		});
}

function stateOf(input: CardInput, row: TicketMonth): string | null {
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

function ticketTable(
	input: CardInput,
	rows: readonly TicketMonth[],
): TableModel {
	const withState = rows.some((row) => row.basis !== "all_stores");
	const withCovered = rows.some((row) => row.basis === "like_for_like");
	const columns: TableColumnModel[] = [
		column("month", reportKeys.table.month, "month"),
		column("avgTicket", reportKeys.table.avgTicket, "money"),
		column("itemsPerTicket", reportKeys.table.itemsPerTicket, "ratio"),
		column("avgItemPrice", reportKeys.table.avgItemPrice, "money"),
		...(withCovered
			? [column("coveredTicket", yearKeys.table.coveredTicket, "money")]
			: []),
		column("lastYearTicket", yearKeys.table.lastYearTicket, "money"),
		column("change", yearKeys.table.changeLastYear, "signedPercent"),
		column("itemsEffect", yearKeys.table.itemsEffect, "money"),
		column("priceEffect", yearKeys.table.priceEffect, "money"),
		...(withState ? [column("state", reportKeys.table.state, "message")] : []),
	];
	return tableModel({
		captionKey: yearKeys.ticket.table,
		columns,
		rows: rows.map((row) => ({
			id: row.month,
			cells: {
				month: row.month.slice(0, 7),
				avgTicket: row.avgTicket,
				itemsPerTicket: row.itemsPerTicket,
				avgItemPrice: row.avgItemPrice,
				coveredTicket: row.basis === "like_for_like" ? row.coveredTicket : null,
				lastYearTicket: row.lastYearTicket,
				change: row.change,
				itemsEffect: row.itemsEffect,
				priceEffect: row.priceEffect,
				state: stateOf(input, row),
			},
		})),
	});
}

function yearTickets(months: SeriesIndex, year: number): (number | null)[] {
	return YEAR_MONTH_NUMBERS.map((month) => {
		const row = months.all(monthStartOf(year, month));
		return hasData(row) ? row.avg_ticket : null;
	});
}

function ticketChart(
	months: SeriesIndex,
	bounds: YearBounds,
): ChartModel | null {
	const current = yearTickets(months, bounds.year);
	const previous = yearTickets(months, bounds.year - 1);
	if ([...current, ...previous].every((value) => value === null)) return null;
	return {
		labelKey: yearKeys.ticket.chart,
		categories: YEAR_MONTH_NUMBERS.map((month) =>
			monthOfYearValue(monthStartOf(bounds.year, month)),
		),
		series: [
			{
				label: part(yearKeys.ticket.series, { year: yearValue(bounds) }),
				kind: "line",
				tone: "primary",
				axis: "left",
				stack: null,
				values: current,
			},
			{
				label: part(yearKeys.ticket.series, { year: lastYearValue(bounds) }),
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
		markAreas: [],
		zeroBased: false,
	};
}

export function buildTicketTrendCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const bounds = boundsOf(context);
	const rows = compareRows(input);
	const months = monthIndex(input);
	const comparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input.results),
		coverage,
		kinds: ["last_year"],
		pick: (row) => row.avg_ticket,
		labels: lastYearLabels(),
	});
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.avg_ticket,
	);
	const lastYear = comparisonOf(comparisons, "last_year");
	const against = decompositionAgainst(comparisons);
	const inputs =
		against === null ? null : decompositionInputs(rows, coverage, against);
	const split =
		against === null || inputs === null
			? null
			: decomposition(
					"avg_ticket",
					"last_year",
					against.basis,
					decomposeTicket(inputs.current, inputs.reference),
				);
	const values: Record<string, TypedValue> = { year: yearValue(bounds) };
	if (current !== null) values.value = numberValue("money", current);
	const young = youngStoreNote(context, coverage, bounds.lastYearStart);
	const notes: SentencePart[] = young === null ? [] : [young];
	const notice: NoticeModel | null =
		current === null
			? {
					tone: "info",
					part: part(yearKeys.noSales, { year: yearValue(bounds) }),
					action: null,
				}
			: null;
	return {
		id: "ticket_trend",
		titleKey: yearKeys.ticket.title,
		subtitle: null,
		metricId: "avg_ticket",
		relatedMetricIds: ["items_per_ticket", "avg_item_price"],
		headline: { value: current, unit: "money", caption: null },
		comparisons,
		decomposition: split,
		narrative: narrate({
			main: {
				up: yearKeys.ticket.up,
				down: yearKeys.ticket.down,
				flat: yearKeys.ticket.flat,
				noReference: yearKeys.ticket.noReference,
				noData: yearKeys.ticket.noData,
			},
			values,
			current,
			comparison: lastYear,
			notes,
			drivers: [],
			decomposition: split,
		}),
		tables: [ticketTable(input, ticketMonths(input))],
		chart: ticketChart(months, bounds),
		notice,
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "ticket_trend"),
	};
}

export const ticketTrendCard: CardDefinition = {
	id: "ticket_trend",
	needs: yearNeeds.ticket,
	visible: () => true,
	build: buildTicketTrendCard,
};
