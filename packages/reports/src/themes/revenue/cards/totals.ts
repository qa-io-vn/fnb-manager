import type {
	CardModel,
	ChartModel,
	Comparison,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import type { ReferenceKind } from "../../../model/comparison.js";
import {
	decomposeNet,
	decomposeTicket,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys } from "../../../model/keys.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { exactDifference } from "../../../model/numeric.js";
import {
	column,
	periodComparisonTable,
	storeComparisonTable,
} from "../../../model/tables.js";
import {
	changeCell,
	comparisonOf,
	decompositionInputs,
	isMultiStore,
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
	partValue,
	plainKindOf,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import {
	comparisonsFromRangeRows,
	type RangeTotalsRow,
	type ThemeCardInput,
	TOTALS_LIKE_FOR_LIKE_KEYS,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { revenueKeys } from "../keys.js";
import { asPeriodRows, revenueCsvName, totalsRowsOf } from "../support.js";

export interface TotalsValues {
	readonly net_amount: number | null;
	readonly invoices: number | null;
	readonly avg_ticket: number | null;
	readonly items_per_ticket: number | null;
	readonly avg_item_price: number | null;
}

type ClauseKeys = typeof revenueKeys.net | typeof revenueKeys.invoices;

export interface RevenueTotalsSpec {
	readonly id: "net_revenue" | "invoices" | "avg_ticket";
	readonly keys: ClauseKeys | typeof revenueKeys.avgTicket;
	readonly metricId: string;
	readonly relatedMetricIds: readonly string[];
	readonly unit: "money" | "count";
	readonly valueLabelKey: string;
	readonly pick: (row: TotalsValues) => number | null;
	readonly decomposes: "net" | "ticket" | null;
	readonly storeDrivers: boolean;
}

export function likeForLikeRows(
	input: ThemeCardInput,
): Partial<Record<ReferenceKind, readonly RangeTotalsRow[]>> {
	return {
		previous: totalsRowsOf(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.previous),
		last_year: totalsRowsOf(input.results, TOTALS_LIKE_FOR_LIKE_KEYS.last_year),
	};
}

export function revenueComparisons(
	input: ThemeCardInput,
	pick: (row: TotalsValues) => number | null,
): readonly Comparison[] {
	return comparisonsFromRangeRows({
		context: input.context,
		all: totalsRowsOf(input.results),
		likeForLike: likeForLikeRows(input),
		coverage: input.coverage,
		pick,
	});
}

export function periodRows(input: ThemeCardInput): TotalsRow[] {
	return asPeriodRows(totalsRowsOf(input.results));
}

function storeDrivers(
	spec: RevenueTotalsSpec,
	input: ThemeCardInput,
	main: Comparison | null,
): DriverCandidate[] {
	if (!spec.storeDrivers || !isMultiStore(input.context)) return [];
	if (main?.range === null || main === null) return [];
	const covered =
		main.basis === "like_for_like"
			? input.coverage.forReference(main.range.from).coveredStoreIds
			: null;
	return storeTotals(input.context, periodRows(input))
		.filter(({ store }) => covered === null || covered.includes(store.id))
		.flatMap(({ store, current, previous }) => {
			const now = pickFrom(current, spec.pick);
			const before = pickFrom(previous, spec.pick);
			if (now === null || before === null) return [];
			return [
				{
					dimension: "store" as const,
					label: textValue("text", store.name),
					contribution: exactDifference(now, before),
					unit: spec.unit,
				},
			];
		});
}

function storeTable(
	spec: RevenueTotalsSpec,
	input: ThemeCardInput,
): TableModel {
	const rows = periodRows(input);
	const totals = storeTotals(input.context, rows);
	const lastYear = input.context.range.lastYear;
	const states = totals.map(({ store }) =>
		lastYear === null
			? null
			: youngStoreState(input.coverage, store.id, lastYear.from),
	);
	const columns: TableColumnModel[] = [
		column("value", spec.valueLabelKey, spec.unit),
		column("previous", revenueKeys.table.previous, spec.unit),
		column("changePrevious", revenueKeys.table.changePrevious, "signedPercent"),
		...(lastYear === null
			? []
			: [
					column("lastYear", revenueKeys.table.lastYear, spec.unit),
					column(
						"changeLastYear",
						revenueKeys.table.changeLastYear,
						"signedPercent",
					),
				]),
		...(states.some((state) => state !== null)
			? [column("state", reportKeys.table.state, "message")]
			: []),
	];
	return storeComparisonTable({
		captionKey: spec.keys.storeTable,
		stores: totals.map(({ store }) => store),
		columns,
		cells: (store) => {
			const entry = totals.find((candidate) => candidate.store.id === store.id);
			const now = pickFrom(entry?.current, spec.pick);
			const previous = pickFrom(entry?.previous, spec.pick);
			const reference = pickFrom(entry?.lastYear, spec.pick);
			return {
				value: now,
				previous,
				changePrevious: changeCell(now, previous),
				lastYear: reference,
				changeLastYear: changeCell(now, reference),
				state:
					lastYear === null
						? null
						: youngStoreState(input.coverage, store.id, lastYear.from),
			};
		},
		initialSort: { key: "value", direction: "descending" },
	});
}

function periodTable(
	spec: RevenueTotalsSpec,
	input: ThemeCardInput,
	columns: readonly TableColumnModel[],
	cellsOf: (
		row: TotalsRow | undefined,
	) => Readonly<Record<string, number | null>>,
): TableModel {
	const rows = periodRows(input);
	const store =
		input.context.stores.length === 1 ? input.context.stores[0] : undefined;
	const lastYear = input.context.range.lastYear;
	const lastYearState =
		store === undefined || lastYear === null
			? null
			: youngStoreState(input.coverage, store.id, lastYear.from);
	const withState = lastYearState !== null;
	return periodComparisonTable({
		captionKey: spec.keys.periodTable,
		columns: [
			...columns,
			...(withState
				? [column("state", reportKeys.table.state, "message")]
				: []),
		],
		periods: [
			{
				id: "current",
				labelKey: revenueKeys.periodRow.current,
				cells: {
					...cellsOf(totalsOf(rows, null, "current")),
					...(withState ? { state: null } : {}),
				},
			},
			{
				id: "previous",
				labelKey: revenueKeys.periodRow.previous,
				cells: {
					...cellsOf(totalsOf(rows, null, "previous")),
					...(withState ? { state: null } : {}),
				},
			},
			...(lastYear === null
				? []
				: [
						{
							id: "last_year",
							labelKey: revenueKeys.periodRow.lastYear,
							cells: {
								...cellsOf(totalsOf(rows, null, "last_year")),
								...(withState ? { state: lastYearState } : {}),
							},
						},
					]),
		],
	});
}

export function totalsColumns(): readonly TableColumnModel[] {
	return [
		column("net", reportKeys.table.netAmount, "money"),
		column("invoices", reportKeys.table.invoices, "count"),
		column("avgTicket", reportKeys.table.avgTicket, "money"),
	];
}

export function totalsCells(
	row: TotalsRow | undefined,
): Readonly<Record<string, number | null>> {
	return {
		net: row?.net_amount ?? null,
		invoices: row?.invoices ?? null,
		avgTicket: row?.avg_ticket ?? null,
	};
}

export function ticketColumns(): readonly TableColumnModel[] {
	return [
		column("avgTicket", reportKeys.table.avgTicket, "money"),
		column("itemsPerTicket", reportKeys.table.itemsPerTicket, "decimal"),
		column("avgItemPrice", reportKeys.table.avgItemPrice, "money"),
	];
}

export function ticketCells(
	row: TotalsRow | undefined,
): Readonly<Record<string, number | null>> {
	return {
		avgTicket: row?.avg_ticket ?? null,
		itemsPerTicket: row?.items_per_ticket ?? null,
		avgItemPrice: row?.avg_item_price ?? null,
	};
}

function storeChart(
	spec: RevenueTotalsSpec,
	input: ThemeCardInput,
): ChartModel {
	const totals = storeTotals(input.context, periodRows(input));
	return {
		labelKey: spec.keys.chart,
		categories: totals.map(({ store }) => textValue("text", store.name)),
		series: [
			{
				label: part(revenueKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: totals.map(({ current }) => pickFrom(current, spec.pick)),
			},
			{
				label: part(revenueKeys.periodRow.previous),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: totals.map(({ previous }) => pickFrom(previous, spec.pick)),
			},
		],
		leftUnit: spec.unit,
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function notesOf(input: ThemeCardInput): SentencePart[] {
	const lastYear = input.context.range.lastYear;
	if (lastYear === null) return [];
	const note = youngStoreNote(input.context, input.coverage, lastYear.from);
	return note === null ? [] : [note];
}

export function buildRevenueTotalsCard(
	spec: RevenueTotalsSpec,
	input: ThemeCardInput,
): CardModel {
	const { context, coverage } = input;
	const rows = periodRows(input);
	const comparisons = revenueComparisons(input, spec.pick);
	const previous = comparisonOf(comparisons, "previous");
	const current = pickFrom(totalsOf(rows, null, "current"), spec.pick);
	const against =
		spec.decomposes === null ? null : decompositionAgainst(comparisons);
	const inputs =
		against === null ? null : decompositionInputs(rows, coverage, against);
	const kind = against?.kind === "last_year" ? "last_year" : "previous";
	const split =
		against === null || inputs === null
			? null
			: spec.decomposes === "ticket"
				? decomposition(
						"avg_ticket",
						kind,
						against.basis,
						decomposeTicket(inputs.current, inputs.reference),
					)
				: decomposition(
						"net_revenue",
						kind,
						against.basis,
						decomposeNet(inputs.current, inputs.reference),
					);
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (current !== null) {
		values.value = numberValue(plainKindOf(spec.unit), current);
	}
	if (previous !== null) values.reference = partValue(previous.label);
	const multiStore = isMultiStore(context);
	const tables =
		spec.id === "avg_ticket"
			? [periodTable(spec, input, ticketColumns(), ticketCells)]
			: multiStore
				? [storeTable(spec, input)]
				: [periodTable(spec, input, totalsColumns(), totalsCells)];
	return {
		id: spec.id,
		titleKey: spec.keys.title,
		subtitle: null,
		metricId: spec.metricId,
		relatedMetricIds: spec.relatedMetricIds,
		headline: { value: current, unit: spec.unit, caption: null },
		comparisons,
		decomposition: split,
		narrative: narrate({
			main: {
				up: spec.keys.up,
				down: spec.keys.down,
				flat: spec.keys.flat,
				noReference: spec.keys.noReference,
				noData: spec.keys.noData,
			},
			values,
			current,
			comparison: previous,
			notes: notesOf(input),
			drivers: storeDrivers(spec, input, previous),
			decomposition: split,
			references: comparisons,
		}),
		tables,
		chart:
			multiStore && spec.id !== "avg_ticket" ? storeChart(spec, input) : null,
		notice: null,
		markers: themeMarkers(input, false),
		csvName: revenueCsvName(context, spec.id),
	};
}
