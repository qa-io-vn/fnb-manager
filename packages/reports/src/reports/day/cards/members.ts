import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, TableModel } from "../../../model/card.js";
import { comparisonsFromPeriodRows } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
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
	compareRows,
	comparisonOf,
	dayCsvName,
	dayLabels,
	dayMarkers,
	dayNeeds,
	dayValue,
	isMultiStore,
	likeForLikeTotals,
	pickFrom,
	storeTotals,
	type TotalsRow,
	totalsOf,
} from "../support.js";

const memberColumns = [
	column("invoices", reportKeys.table.invoices, "count"),
	column("memberInvoices", reportKeys.table.memberInvoices, "count"),
	column("memberShare", reportKeys.table.memberShare, "percent"),
	column("captureRate", reportKeys.table.captureRate, "percent"),
];

function memberCells(row: TotalsRow | undefined) {
	return {
		invoices: row?.invoices ?? null,
		memberInvoices: row?.member_invoices ?? null,
		memberShare: row?.member_share ?? null,
		captureRate: row?.identified_share ?? null,
	};
}

function storeTable(input: CardInput): TableModel {
	const totals = storeTotals(input);
	return storeComparisonTable({
		captionKey: dayKeys.members.table,
		stores: totals.map(({ store }) => store),
		columns: memberColumns,
		cells: (store) =>
			memberCells(
				totals.find((candidate) => candidate.store.id === store.id)?.current,
			),
		initialSort: { key: "memberShare", direction: "ascending" },
	});
}

function periodTable(input: CardInput): TableModel {
	const rows = compareRows(input);
	return periodComparisonTable({
		captionKey: dayKeys.members.table,
		columns: memberColumns,
		periods: [
			{
				id: "current",
				labelKey: reportKeys.periodRow.current,
				cells: memberCells(totalsOf(rows, null, "current")),
			},
			{
				id: "previous",
				labelKey: reportKeys.periodRow.previous,
				cells: memberCells(totalsOf(rows, null, "previous")),
			},
			{
				id: "last_year",
				labelKey: reportKeys.periodRow.lastYear,
				cells: memberCells(totalsOf(rows, null, "last_year")),
			},
		],
	});
}

function lowestStoreClause(input: CardInput): SentencePart | null {
	let lowest: { name: string; share: number } | null = null;
	for (const { store, current } of storeTotals(input)) {
		const share = pickFrom(current, (row) => row.member_share);
		if (share === null) continue;
		if (lowest === null || share < lowest.share) {
			lowest = { name: store.name, share };
		}
	}
	if (lowest === null) return null;
	return part(dayKeys.members.lowestStore, {
		store: textValue("text", lowest.name),
		share: numberValue("percent", lowest.share),
	});
}

export function buildMembersCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.member_share,
	);
	const comparisons = comparisonsFromPeriodRows({
		all: rows,
		likeForLike: likeForLikeTotals(input),
		coverage,
		kinds: ["previous"],
		pick: (row) => row.member_share,
		labels: dayLabels(),
	});
	const multiStore = isMultiStore(context);
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (current !== null) values.value = numberValue("percent", current);
	const parts =
		current === 0
			? [part(dayKeys.members.zero)]
			: narrate({
					main: {
						up: dayKeys.members.up,
						down: dayKeys.members.down,
						flat: dayKeys.members.flat,
						noReference: dayKeys.members.noReference,
						noData: dayKeys.members.noData,
					},
					values,
					current,
					comparison: comparisonOf(comparisons, "previous"),
					notes: [],
					drivers: [],
					decomposition: null,
				});
	const lowest =
		multiStore && current !== null && current !== 0
			? lowestStoreClause(input)
			: null;
	return {
		id: "members",
		titleKey: dayKeys.members.title,
		subtitle: null,
		metricId: "member_invoice_share",
		relatedMetricIds: ["customer_capture_rate"],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons,
		decomposition: null,
		narrative: lowest === null ? parts : [...parts, lowest].slice(0, 3),
		tables: [multiStore ? storeTable(input) : periodTable(input)],
		chart: null,
		notice: null,
		markers: dayMarkers(input, false),
		csvName: dayCsvName(context, "members"),
	};
}

export const membersCard: CardDefinition = {
	id: "members",
	needs: dayNeeds.members,
	visible: () => true,
	build: buildMembersCard,
};
