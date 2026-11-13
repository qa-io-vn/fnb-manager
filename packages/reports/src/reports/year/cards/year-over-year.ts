import type {
	CardDefinition,
	CardInput,
	ReportStore,
} from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	Comparison,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { comparisonsFromPeriodRows } from "../../../model/comparison.js";
import {
	decomposeNet,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoneyOrNull } from "../../../model/money.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { exactDifference, relativeChange } from "../../../model/numeric.js";
import {
	column,
	periodComparisonTable,
	storeComparisonTable,
} from "../../../model/tables.js";
import {
	comparisonOf,
	decompositionInputs,
	isMultiStore,
	likeForLikeTotals,
	pickFrom,
	storeTotals,
	type TotalsRow,
	totalsOf,
	youngStoreNote,
	youngStoreState,
} from "../../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { addYears } from "../../../period/dates.js";
import { yearKeys } from "../keys.js";
import {
	completeMonthsOfYear,
	hasData,
	type SeriesIndex,
	type YearBounds,
} from "../rules.js";
import {
	boundsOf,
	compareRows,
	lastYearLabels,
	monthIndex,
	monthValue,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

export const MIN_STORE_DRIVERS = 2;

export function driverStoreIds(
	input: CardInput,
	lastYear: Comparison | null,
): string[] {
	if (lastYear === null || lastYear.unavailable !== null) return [];
	const bounds = boundsOf(input.context);
	if (lastYear.basis === "all_stores") {
		return input.context.stores.map((store) => store.id);
	}
	return [...input.coverage.forReference(bounds.lastYearStart).coveredStoreIds];
}

function storeDrivers(
	rows: readonly TotalsRow[],
	stores: readonly ReportStore[],
	storeIds: readonly string[],
): DriverCandidate[] {
	return stores.flatMap((store) => {
		if (!storeIds.includes(store.id)) return [];
		const now = pickFrom(
			totalsOf(rows, store.id, "current"),
			(row) => row.net_amount,
		);
		const before = pickFrom(
			totalsOf(rows, store.id, "last_year"),
			(row) => row.net_amount,
		);
		if (now === null || before === null) return [];
		return [
			{
				dimension: "store" as const,
				label: textValue("text", store.name),
				contribution: exactDifference(now, before),
				unit: "money" as const,
			},
		];
	});
}

function coveredMonthNet(
	months: SeriesIndex,
	storeIds: readonly string[],
	month: string,
): number {
	return (
		sumMoneyOrNull(
			storeIds.map((id) => {
				const row = months.store(id, month);
				return hasData(row) ? row.net_amount : null;
			}),
		) ?? 0
	);
}

export function monthDrivers(
	months: SeriesIndex,
	bounds: YearBounds,
	storeIds: readonly string[],
): DriverCandidate[] {
	if (storeIds.length === 0) return [];
	return completeMonthsOfYear(bounds.year, bounds.asOf, bounds.yearEnd).map(
		(month) => ({
			dimension: "month" as const,
			label: monthValue(month),
			contribution: exactDifference(
				coveredMonthNet(months, storeIds, month),
				coveredMonthNet(months, storeIds, addYears(month, -1)),
			),
			unit: "money" as const,
		}),
	);
}

function storeTable(input: CardInput, rows: readonly TotalsRow[]): TableModel {
	const bounds = boundsOf(input.context);
	const totals = storeTotals(input.context, rows);
	const states = totals.map(({ store }) =>
		youngStoreState(input.coverage, store.id, bounds.lastYearStart),
	);
	const columns: TableColumnModel[] = [
		column("ytd", yearKeys.table.netYtd, "money"),
		column("lastYtd", yearKeys.table.lastYtd, "money"),
		column("change", yearKeys.table.changeLastYear, "signedPercent"),
		...(states.some((state) => state !== null)
			? [column("state", reportKeys.table.state, "message")]
			: []),
	];
	return storeComparisonTable({
		captionKey: yearKeys.yearOverYear.table,
		stores: totals.map(({ store }) => store),
		columns,
		cells: (store) => {
			const entry = totals.find((candidate) => candidate.store.id === store.id);
			const state = youngStoreState(
				input.coverage,
				store.id,
				bounds.lastYearStart,
			);
			const now = pickFrom(entry?.current, (row) => row.net_amount);
			const before =
				state === null
					? pickFrom(entry?.lastYear, (row) => row.net_amount)
					: null;
			return {
				ytd: now,
				lastYtd: before,
				change: relativeChange(now, before),
				state,
			};
		},
		initialSort: { key: "ytd", direction: "descending" },
	});
}

function periodTable(input: CardInput, rows: readonly TotalsRow[]): TableModel {
	const bounds = boundsOf(input.context);
	const storeId = input.context.stores[0]?.id ?? null;
	const state =
		storeId === null
			? null
			: youngStoreState(input.coverage, storeId, bounds.lastYearStart);
	const cellsOf = (row: TotalsRow | undefined, rowState: string | null) => ({
		net: rowState === null ? (row?.net_amount ?? null) : null,
		invoices: rowState === null ? (row?.invoices ?? null) : null,
		avgTicket: rowState === null ? (row?.avg_ticket ?? null) : null,
		state: rowState,
	});
	return periodComparisonTable({
		captionKey: yearKeys.yearOverYear.periodTable,
		columns: [
			column("net", reportKeys.table.netAmount, "money"),
			column("invoices", reportKeys.table.invoices, "count"),
			column("avgTicket", reportKeys.table.avgTicket, "money"),
			...(state === null
				? []
				: [column("state", reportKeys.table.state, "message")]),
		],
		periods: [
			{
				id: "current",
				labelKey: reportKeys.periodRow.current,
				cells: cellsOf(totalsOf(rows, null, "current"), null),
			},
			{
				id: "last_year",
				labelKey: reportKeys.periodRow.lastYear,
				cells: cellsOf(totalsOf(rows, null, "last_year"), state),
			},
		],
	});
}

function storeChart(input: CardInput, rows: readonly TotalsRow[]): ChartModel {
	const bounds = boundsOf(input.context);
	const totals = storeTotals(input.context, rows);
	return {
		labelKey: yearKeys.yearOverYear.chart,
		categories: totals.map(({ store }) => textValue("text", store.name)),
		series: [
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: totals.map(({ current }) =>
					pickFrom(current, (row) => row.net_amount),
				),
			},
			{
				label: part(reportKeys.periodRow.lastYear),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: totals.map(({ store, lastYear }) =>
					youngStoreState(input.coverage, store.id, bounds.lastYearStart) ===
					null
						? pickFrom(lastYear, (row) => row.net_amount)
						: null,
				),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildYearOverYearCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const bounds = boundsOf(context);
	const rows = compareRows(input);
	const months = monthIndex(input);
	const comparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input.results),
		coverage,
		kinds: ["last_year"],
		pick: (row) => row.net_amount,
		labels: lastYearLabels(),
	});
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.net_amount,
	);
	const lastYear = comparisonOf(comparisons, "last_year");
	const against = decompositionAgainst(comparisons);
	const inputs =
		against === null ? null : decompositionInputs(rows, coverage, against);
	const split =
		against === null || inputs === null
			? null
			: decomposition(
					"net_revenue",
					"last_year",
					against.basis,
					decomposeNet(inputs.current, inputs.reference),
				);
	const driverIds = driverStoreIds(input, lastYear);
	const drivers =
		isMultiStore(context) && driverIds.length >= MIN_STORE_DRIVERS
			? storeDrivers(rows, context.stores, driverIds)
			: monthDrivers(months, bounds, driverIds);
	const values: Record<string, TypedValue> = { year: yearValue(bounds) };
	if (current !== null) values.value = numberValue("money", current);
	const young = youngStoreNote(context, coverage, bounds.lastYearStart);
	const tooYoung = lastYear?.unavailable === "store_too_young";
	const notes: SentencePart[] =
		young !== null && lastYear?.basis === "like_for_like" ? [young] : [];
	const notice: NoticeModel | null =
		current === null
			? {
					tone: "info",
					part: part(yearKeys.noSales, { year: yearValue(bounds) }),
					action: null,
				}
			: tooYoung && young !== null
				? { tone: "info", part: young, action: null }
				: null;
	const multiStore = isMultiStore(context);
	return {
		id: "year_over_year",
		titleKey: yearKeys.yearOverYear.title,
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: ["invoices", "avg_ticket"],
		headline: { value: current, unit: "money", caption: null },
		comparisons,
		decomposition: split,
		narrative: narrate({
			main: {
				up: yearKeys.yearOverYear.up,
				down: yearKeys.yearOverYear.down,
				flat: yearKeys.yearOverYear.flat,
				noReference: yearKeys.yearOverYear.noReference,
				noData: yearKeys.yearOverYear.noData,
			},
			values,
			current,
			comparison: lastYear,
			notes,
			drivers,
			decomposition: split,
		}),
		tables: [multiStore ? storeTable(input, rows) : periodTable(input, rows)],
		chart: storeChart(input, rows),
		notice,
		markers: yearMarkers(input, false),
		csvName: yearCsvName(context, "year_over_year"),
	};
}

export const yearOverYearCard: CardDefinition = {
	id: "year_over_year",
	needs: yearNeeds.yearOverYear,
	visible: () => true,
	build: buildYearOverYearCard,
};
