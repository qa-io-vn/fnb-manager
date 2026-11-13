import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, TableModel } from "../../../model/card.js";
import { comparisonsFromPeriodRows } from "../../../model/comparison.js";
import {
	decomposeTicket,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys } from "../../../model/keys.js";
import { mainClauseOf, narrate } from "../../../model/narrative.js";
import {
	column,
	periodComparisonTable,
	storeComparisonTable,
} from "../../../model/tables.js";
import {
	numberValue,
	part,
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
	isMultiStore,
	likeForLikeTotals,
	pickFrom,
	type StoreTotals,
	storeTotals,
	type TotalsRow,
	totalsOf,
} from "../support.js";

const ratioColumns = [
	column("avgTicket", reportKeys.table.avgTicket, "money"),
	column("itemsPerTicket", reportKeys.table.itemsPerTicket, "ratio"),
	column("avgItemPrice", reportKeys.table.avgItemPrice, "money"),
];

function ratioCells(row: TotalsRow | undefined) {
	return {
		avgTicket: row?.avg_ticket ?? null,
		itemsPerTicket: row?.items_per_ticket ?? null,
		avgItemPrice: row?.avg_item_price ?? null,
	};
}

function storeTable(input: CardInput): TableModel {
	const totals = storeTotals(input);
	return storeComparisonTable({
		captionKey: dayKeys.avgTicket.table,
		stores: totals.map(({ store }) => store),
		columns: [
			...ratioColumns,
			column("changePrevious", dayKeys.table.changePrevious, "signedPercent"),
		],
		cells: (store) => {
			const entry = totals.find((candidate) => candidate.store.id === store.id);
			return {
				...ratioCells(entry?.current),
				changePrevious: changeCell(
					entry?.current?.avg_ticket ?? null,
					entry?.previous?.avg_ticket ?? null,
				),
			};
		},
		initialSort: { key: "avgTicket", direction: "descending" },
	});
}

function periodTable(input: CardInput): TableModel {
	const rows = compareRows(input);
	return periodComparisonTable({
		captionKey: dayKeys.avgTicket.table,
		columns: ratioColumns,
		periods: [
			{
				id: "current",
				labelKey: reportKeys.periodRow.current,
				cells: ratioCells(totalsOf(rows, null, "current")),
			},
			{
				id: "previous",
				labelKey: reportKeys.periodRow.previous,
				cells: ratioCells(totalsOf(rows, null, "previous")),
			},
			{
				id: "baseline",
				labelKey: reportKeys.periodRow.baseline,
				cells: ratioCells(totalsOf(rows, null, "baseline")),
			},
			{
				id: "last_year",
				labelKey: reportKeys.periodRow.lastYear,
				cells: ratioCells(totalsOf(rows, null, "last_year")),
			},
		],
	});
}

function highestTicketClause(
	totals: readonly StoreTotals[],
): SentencePart | null {
	let best: { name: string; ticket: number } | null = null;
	for (const { store, current } of totals) {
		const ticket = pickFrom(current, (row) => row.avg_ticket);
		if (ticket === null) continue;
		if (best === null || ticket > best.ticket) {
			best = { name: store.name, ticket };
		}
	}
	if (best === null) return null;
	return part(reportKeys.clause.driver.storeHighestTicket, {
		store: textValue("text", best.name),
		value: numberValue("money", best.ticket),
	});
}

export function buildAvgTicketCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const comparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["baseline", "previous", "last_year"],
		pick: (row) => row.avg_ticket,
		labels: dayLabels(),
	});
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.avg_ticket,
	);
	const against = decompositionAgainst(comparisons);
	const inputs = against === null ? null : decompositionInputs(input, against);
	const split =
		against === null || inputs === null
			? null
			: decomposition(
					"avg_ticket",
					against.kind === "previous" ? "previous" : "last_year",
					against.basis,
					decomposeTicket(inputs.current, inputs.reference),
				);
	const baseline = comparisonOf(comparisons, "baseline");
	const multiStore = isMultiStore(context);
	const flatAcrossStores =
		multiStore && mainClauseOf(current, baseline) === "flat";
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (current !== null) values.value = numberValue("money", current);
	const parts = narrate({
		main: {
			up: dayKeys.avgTicket.up,
			down: dayKeys.avgTicket.down,
			flat: dayKeys.avgTicket.flat,
			noReference: dayKeys.avgTicket.noReference,
			noData: dayKeys.avgTicket.noData,
		},
		values,
		current,
		comparison: baseline,
		notes: [],
		drivers: [],
		decomposition: flatAcrossStores ? null : split,
		references: comparisons,
	});
	const highest = flatAcrossStores
		? highestTicketClause(storeTotals(input))
		: null;
	return {
		id: "avg_ticket",
		titleKey: dayKeys.avgTicket.title,
		subtitle: null,
		metricId: "avg_ticket",
		relatedMetricIds: ["items_per_ticket", "avg_item_price"],
		headline: { value: current, unit: "money", caption: null },
		comparisons,
		decomposition: split,
		narrative: highest === null ? parts : [...parts, highest].slice(0, 3),
		tables: [multiStore ? storeTable(input) : periodTable(input)],
		chart: null,
		notice: null,
		markers: dayMarkers(input, false),
		csvName: dayCsvName(context, "avg_ticket"),
	};
}

export const avgTicketCard: CardDefinition = {
	id: "avg_ticket",
	needs: dayNeeds.totals,
	visible: () => true,
	build: buildAvgTicketCard,
};
