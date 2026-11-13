import type { CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	Comparison,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import {
	comparisonsFromPeriodRows,
	type PeriodRowLike,
} from "../../../model/comparison.js";
import {
	decomposeNet,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys, unavailableKey } from "../../../model/keys.js";
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
	likeForLikeTotals,
	pickFrom,
	storeTotals,
	totalsOf,
	youngStoreNote,
	youngStoreState,
} from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	plainKindOf,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { addDays } from "../../../period/dates.js";
import {
	type AverageMetric,
	type FourWeekAverage,
	fourWeekAverage,
	fourWeekComparison,
} from "../four-week-average.js";
import { weekKeys } from "../keys.js";
import {
	compareRows,
	type DayRow,
	dayRowsOf,
	lastYearFrom,
	likeForLikeNote,
	likeForLikeStores,
	type MoneyUnit,
	noDataNotice,
	partialCaption,
	WEEK_DAYS,
	type WeekDays,
	weekCsvName,
	weekDates,
	weekdayValue,
	weekLabels,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";

type TotalsKeys = typeof weekKeys.net | typeof weekKeys.invoices;

export interface WeekTotalsSpec {
	readonly id: "net_revenue" | "invoices";
	readonly keys: TotalsKeys;
	readonly metricId: string;
	readonly relatedMetricIds: readonly string[];
	readonly unit: "money" | "count";
	readonly sumUnit: MoneyUnit;
	readonly valueLabelKey: string;
	readonly average: AverageMetric;
	readonly pick: (row: PeriodRowLike) => number | null;
	readonly pickDay: (row: DayRow) => number | null;
	readonly decomposes: boolean;
	readonly notesYoungStore: boolean;
}

export function weekAverage(input: CardInput): FourWeekAverage {
	return fourWeekAverage({
		period: input.context.period,
		coverage: input.coverage,
		days: dayRowsOf(input),
	});
}

export function averageRowLabel(average: FourWeekAverage): string {
	return average.basis === "like_for_like"
		? weekKeys.periodRow.average4WeeksLikeForLike
		: weekKeys.periodRow.average4Weeks;
}

export function averageState(average: FourWeekAverage): string | null {
	return average.unavailable === null
		? null
		: unavailableKey(average.unavailable, "average_4_weeks");
}

export function weekComparisons(
	input: CardInput,
	pick: (row: PeriodRowLike) => number | null,
	average: FourWeekAverage,
	metric: AverageMetric,
): readonly Comparison[] {
	const rows = compareRows(input);
	const [previous, lastYear] = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input.results),
		coverage: input.coverage,
		kinds: ["previous", "last_year"],
		pick,
		labels: weekLabels(),
	});
	const current = pickFrom(totalsOf(rows, null, "current"), pick);
	const averageChip = fourWeekComparison(average, metric, current);
	return [previous, averageChip, lastYear].filter(
		(entry): entry is Comparison => entry !== undefined,
	);
}

export function weekNotes(
	input: CardInput,
	main: Comparison | null,
	withYoungStore: boolean,
): SentencePart[] {
	const likeForLike = likeForLikeNote(main);
	if (likeForLike !== null) return [likeForLike];
	if (!withYoungStore) return [];
	const young = youngStoreNote(
		input.context,
		input.coverage,
		lastYearFrom(input.context),
	);
	return young === null ? [] : [young];
}

const MIN_DRIVER_STORES = 2;

function storeDrivers(
	spec: WeekTotalsSpec,
	input: CardInput,
	main: Comparison | null,
): DriverCandidate[] {
	const covered = likeForLikeStores(input.coverage, main);
	const totals = storeTotals(input.context, compareRows(input)).filter(
		({ store }) => covered === null || covered.includes(store.id),
	);
	if (totals.length < MIN_DRIVER_STORES) return [];
	return totals.flatMap(({ store, current, previous }) => {
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

export function weekdayDrivers(
	input: CardInput,
	days: WeekDays,
	main: Comparison | null,
	pickDay: (row: DayRow) => number | null,
	unit: MoneyUnit,
	valueUnit: DriverCandidate["unit"],
): DriverCandidate[] {
	const stores = likeForLikeStores(input.coverage, main);
	return weekDates(input.context).flatMap((date) => {
		const now = days.value(stores, date, pickDay, unit);
		const before = days.value(stores, addDays(date, -WEEK_DAYS), pickDay, unit);
		if (now === null && before === null) return [];
		return [
			{
				dimension: "weekday" as const,
				label: weekdayValue(date),
				contribution: exactDifference(now ?? 0, before ?? 0),
				unit: valueUnit,
			},
		];
	});
}

function valueColumn(spec: WeekTotalsSpec, key: string, labelKey: string) {
	return column(key, labelKey, spec.unit);
}

function storeTable(
	spec: WeekTotalsSpec,
	input: CardInput,
	average: FourWeekAverage,
): TableModel {
	const totals = storeTotals(input.context, compareRows(input));
	const referenceFrom = lastYearFrom(input.context);
	const states = totals.map(({ store }) =>
		youngStoreState(input.coverage, store.id, referenceFrom),
	);
	const columns: TableColumnModel[] = [
		valueColumn(spec, "value", spec.valueLabelKey),
		valueColumn(spec, "previous", weekKeys.table.lastWeek),
		column("changePrevious", weekKeys.table.changeLastWeek, "signedPercent"),
		valueColumn(spec, "average", weekKeys.table.average4Weeks),
		column(
			"changeAverage",
			weekKeys.table.changeAverage4Weeks,
			"signedPercent",
		),
		valueColumn(spec, "lastYear", weekKeys.table.lastYear),
		column("changeLastYear", weekKeys.table.changeLastYear, "signedPercent"),
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
			const usual = average.forStore(store.id)[spec.average];
			const lastYear = pickFrom(entry?.lastYear, spec.pick);
			return {
				value: now,
				previous,
				changePrevious: changeCell(now, previous),
				average: usual,
				changeAverage: changeCell(now, usual),
				lastYear,
				changeLastYear: changeCell(now, lastYear),
				state: youngStoreState(input.coverage, store.id, referenceFrom),
			};
		},
		initialSort: { key: "value", direction: "descending" },
	});
}

export function periodRowsTable(
	captionKey: string,
	input: CardInput,
	average: FourWeekAverage,
	columns: readonly TableColumnModel[],
	cellsOf: (
		row: ReturnType<typeof totalsOf>,
	) => Readonly<Record<string, number | null>>,
	averageCells: Readonly<Record<string, number | null>>,
): TableModel {
	const rows = compareRows(input);
	const storeId =
		input.context.stores.length === 1
			? (input.context.stores[0]?.id ?? null)
			: null;
	const lastYearState =
		storeId === null
			? null
			: youngStoreState(input.coverage, storeId, lastYearFrom(input.context));
	const averageRowState = averageState(average);
	const withState = lastYearState !== null || averageRowState !== null;
	const stateCell = (state: string | null) => (withState ? { state } : {});
	return periodComparisonTable({
		captionKey,
		columns: [
			...columns,
			...(withState
				? [column("state", reportKeys.table.state, "message")]
				: []),
		],
		periods: [
			{
				id: "current",
				labelKey: weekKeys.periodRow.current,
				cells: {
					...cellsOf(totalsOf(rows, null, "current")),
					...stateCell(null),
				},
			},
			{
				id: "previous",
				labelKey: weekKeys.periodRow.previous,
				cells: {
					...cellsOf(totalsOf(rows, null, "previous")),
					...stateCell(null),
				},
			},
			{
				id: "average_4_weeks",
				labelKey: averageRowLabel(average),
				cells: { ...averageCells, ...stateCell(averageRowState) },
			},
			{
				id: "last_year",
				labelKey: weekKeys.periodRow.lastYear,
				cells: {
					...cellsOf(totalsOf(rows, null, "last_year")),
					...stateCell(lastYearState),
				},
			},
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
	row: ReturnType<typeof totalsOf>,
): Readonly<Record<string, number | null>> {
	return {
		net: row?.net_amount ?? null,
		invoices: row?.invoices ?? null,
		avgTicket: row?.avg_ticket ?? null,
	};
}

function periodTable(
	spec: WeekTotalsSpec,
	input: CardInput,
	average: FourWeekAverage,
): TableModel {
	return periodRowsTable(
		spec.keys.periodTable,
		input,
		average,
		totalsColumns(),
		totalsCells,
		{
			net: average.reference.net,
			invoices: average.reference.invoices,
			avgTicket: average.reference.avgTicket,
		},
	);
}

function chartOf(
	spec: WeekTotalsSpec,
	input: CardInput,
	average: FourWeekAverage,
): ChartModel {
	const rows = compareRows(input);
	const value = (period: "current" | "previous" | "last_year") =>
		pickFrom(totalsOf(rows, null, period), spec.pick);
	return {
		labelKey: spec.keys.chart,
		categories: [
			messageValue(weekKeys.periodRow.current),
			messageValue(weekKeys.periodRow.previous),
			messageValue(averageRowLabel(average)),
			messageValue(weekKeys.periodRow.lastYear),
		],
		series: [
			{
				label: part(spec.valueLabelKey),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: [
					value("current"),
					value("previous"),
					average.reference[spec.average],
					value("last_year"),
				],
			},
		],
		leftUnit: spec.unit,
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildWeekTotalsCard(
	spec: WeekTotalsSpec,
	input: CardInput,
): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const average = weekAverage(input);
	const comparisons = weekComparisons(input, spec.pick, average, spec.average);
	const previous = comparisonOf(comparisons, "previous");
	const current = pickFrom(totalsOf(rows, null, "current"), spec.pick);
	const against = spec.decomposes ? decompositionAgainst(comparisons) : null;
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
	const multiStore = isMultiStore(context);
	const values: Record<string, TypedValue> = { period: weekValue(context) };
	if (current !== null) {
		values.value = numberValue(plainKindOf(spec.unit), current);
	}
	const days = dayRowsOf(input);
	const drivers = [
		...(multiStore ? storeDrivers(spec, input, previous) : []),
		...weekdayDrivers(
			input,
			days,
			previous,
			spec.pickDay,
			spec.sumUnit,
			spec.unit,
		),
	];
	return {
		id: spec.id,
		titleKey: spec.keys.title,
		subtitle: null,
		metricId: spec.metricId,
		relatedMetricIds: spec.relatedMetricIds,
		headline: {
			value: current,
			unit: spec.unit,
			caption: partialCaption(context),
		},
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
			notes: weekNotes(input, previous, spec.notesYoungStore),
			drivers,
			decomposition: split,
			references: comparisons,
		}),
		tables: [
			multiStore
				? storeTable(spec, input, average)
				: periodTable(spec, input, average),
		],
		chart: chartOf(spec, input, average),
		notice: current === null ? noDataNotice() : null,
		markers: weekMarkers(input, false),
		csvName: weekCsvName(context, spec.id),
	};
}

export const weekTotalsNeeds = weekNeeds.totals;
