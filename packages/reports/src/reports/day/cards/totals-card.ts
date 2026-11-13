import type { CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
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
import { reportKeys } from "../../../model/keys.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { exactDifference } from "../../../model/numeric.js";
import {
	column,
	periodComparisonTable,
	storeComparisonTable,
} from "../../../model/tables.js";
import {
	numberValue,
	part,
	plainKindOf,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { dayKeys } from "../keys.js";
import {
	changeCell,
	compareRows,
	comparisonOf,
	dayCsvName,
	dayLabels,
	dayMarkers,
	dayNeeds,
	dayValue,
	decompositionInputs,
	type HourRow,
	hourRows,
	isMultiStore,
	likeForLikeTotals,
	pickFrom,
	storeTotals,
	totalsOf,
	youngStoreNote,
	youngStoreState,
} from "../support.js";

type TotalsKeys = typeof dayKeys.net | typeof dayKeys.invoices;

export interface TotalsCardSpec {
	readonly id: "net_revenue" | "invoices";
	readonly keys: TotalsKeys;
	readonly metricId: string;
	readonly relatedMetricIds: readonly string[];
	readonly unit: "money" | "count";
	readonly valueLabelKey: string;
	readonly pick: (row: PeriodRowLike) => number | null;
	readonly hourCurrent: (row: HourRow) => number | null;
	readonly hourBaseline: (row: HourRow) => number | null;
	readonly decomposes: boolean;
	readonly notesYoungStore: boolean;
}

function storeDrivers(
	spec: TotalsCardSpec,
	input: CardInput,
): DriverCandidate[] {
	return storeTotals(input).flatMap(({ store, current, baseline }) => {
		const now = pickFrom(current, spec.pick);
		const usual = pickFrom(baseline, spec.pick);
		if (now === null || usual === null) return [];
		return [
			{
				dimension: "store" as const,
				label: textValue("text", store.name),
				contribution: exactDifference(now, usual),
				unit: spec.unit,
			},
		];
	});
}

export function hourDrivers(
	input: CardInput,
	current: (row: HourRow) => number | null,
	baseline: (row: HourRow) => number | null,
	unit: DriverCandidate["unit"],
): DriverCandidate[] {
	return hourRows(input).flatMap((row) => {
		if (row.sample_days < 1) return [];
		const now = current(row);
		const usual = baseline(row);
		if (now === null || usual === null) return [];
		return [
			{
				dimension: "hour" as const,
				label: numberValue("hour", row.hour_local),
				contribution: exactDifference(now, usual),
				unit,
			},
		];
	});
}

function valueColumn(spec: TotalsCardSpec, key: string, labelKey: string) {
	return column(key, labelKey, spec.unit);
}

function storeTable(spec: TotalsCardSpec, input: CardInput): TableModel {
	const totals = storeTotals(input);
	const states = totals.map(({ store }) => youngStoreState(input, store.id));
	const columns: TableColumnModel[] = [
		valueColumn(spec, "value", spec.valueLabelKey),
		valueColumn(spec, "baseline", reportKeys.table.baseline),
		column("changeBaseline", dayKeys.table.changeBaseline, "signedPercent"),
		valueColumn(spec, "previous", dayKeys.table.previousDay),
		column("changePrevious", dayKeys.table.changePrevious, "signedPercent"),
		valueColumn(spec, "lastYear", dayKeys.table.lastYearDay),
		column("changeLastYear", dayKeys.table.changeLastYear, "signedPercent"),
		...(states.some((state) => state !== null)
			? [column("state", reportKeys.table.state, "message")]
			: []),
	];
	return storeComparisonTable({
		captionKey: spec.keys.table,
		stores: totals.map(({ store }) => store),
		columns,
		cells: (store) => {
			const entry = totals.find((candidate) => candidate.store.id === store.id);
			const now = pickFrom(entry?.current, spec.pick);
			const usual = pickFrom(entry?.baseline, spec.pick);
			const previous = pickFrom(entry?.previous, spec.pick);
			const lastYear = pickFrom(entry?.lastYear, spec.pick);
			return {
				value: now,
				baseline: usual,
				changeBaseline: changeCell(now, usual),
				previous,
				changePrevious: changeCell(now, previous),
				lastYear,
				changeLastYear: changeCell(now, lastYear),
				state: youngStoreState(input, store.id),
			};
		},
		initialSort: { key: "value", direction: "descending" },
	});
}

function periodTable(spec: TotalsCardSpec, input: CardInput): TableModel {
	const rows = compareRows(input);
	const now = pickFrom(totalsOf(rows, null, "current"), spec.pick);
	const storeId = input.context.stores[0]?.id ?? null;
	const lastYearState =
		storeId === null ? null : youngStoreState(input, storeId);
	const reference = (
		id: string,
		labelKey: string,
		period: "previous" | "baseline" | "last_year",
		state: string | null,
	) => {
		const value = pickFrom(totalsOf(rows, null, period), spec.pick);
		return {
			id,
			labelKey,
			cells: { value, change: changeCell(now, value), state },
		};
	};
	return periodComparisonTable({
		captionKey: spec.keys.table,
		columns: [
			valueColumn(spec, "value", spec.valueLabelKey),
			column("change", reportKeys.table.change, "signedPercent"),
			...(lastYearState === null
				? []
				: [column("state", reportKeys.table.state, "message")]),
		],
		periods: [
			{
				id: "current",
				labelKey: reportKeys.periodRow.current,
				cells: { value: now, change: null, state: null },
			},
			reference("previous", reportKeys.periodRow.previous, "previous", null),
			reference("baseline", reportKeys.periodRow.baseline, "baseline", null),
			reference(
				"last_year",
				reportKeys.periodRow.lastYear,
				"last_year",
				lastYearState,
			),
		],
	});
}

function storeChart(spec: TotalsCardSpec, input: CardInput): ChartModel {
	const totals = storeTotals(input);
	return {
		labelKey: spec.keys.chart,
		categories: totals.map(({ store }) => textValue("text", store.name)),
		series: [
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: totals.map(({ current }) => pickFrom(current, spec.pick)),
			},
			{
				label: part(reportKeys.periodRow.baseline),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: totals.map(({ baseline }) => pickFrom(baseline, spec.pick)),
			},
		],
		leftUnit: spec.unit,
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildTotalsCard(
	spec: TotalsCardSpec,
	input: CardInput,
): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const comparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["baseline", "previous", "last_year"],
		pick: spec.pick,
		labels: dayLabels(),
	});
	const current = pickFrom(totalsOf(rows, null, "current"), spec.pick);
	const against = spec.decomposes ? decompositionAgainst(comparisons) : null;
	const inputs = against === null ? null : decompositionInputs(input, against);
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
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (current !== null)
		values.value = numberValue(plainKindOf(spec.unit), current);
	const note = spec.notesYoungStore ? youngStoreNote(input) : null;
	const notes: SentencePart[] = note === null ? [] : [note];
	const drivers = [
		...(multiStore ? storeDrivers(spec, input) : []),
		...hourDrivers(input, spec.hourCurrent, spec.hourBaseline, spec.unit),
	];
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
			comparison: comparisonOf(comparisons, "baseline"),
			notes,
			drivers,
			decomposition: split,
			references: comparisons,
		}),
		tables: [multiStore ? storeTable(spec, input) : periodTable(spec, input)],
		chart: multiStore ? storeChart(spec, input) : null,
		notice: null,
		markers: dayMarkers(input, false),
		csvName: dayCsvName(context, spec.id),
	};
}

export const totalsNeeds = dayNeeds.totalsWithHours;
