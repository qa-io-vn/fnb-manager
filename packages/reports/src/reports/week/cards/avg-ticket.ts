import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel } from "../../../model/card.js";
import {
	decomposeTicket,
	decomposition,
	decompositionAgainst,
} from "../../../model/decomposition.js";
import { reportKeys } from "../../../model/keys.js";
import { narrate } from "../../../model/narrative.js";
import { column } from "../../../model/tables.js";
import {
	comparisonOf,
	decompositionInputs,
	pickFrom,
	totalsOf,
} from "../../../model/totals.js";
import { numberValue, type TypedValue } from "../../../model/values.js";
import { weekKeys } from "../keys.js";
import {
	compareRows,
	noDataNotice,
	partialCaption,
	weekCsvName,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";
import {
	periodRowsTable,
	weekAverage,
	weekComparisons,
	weekNotes,
} from "./totals-card.js";

const ratioColumns = [
	column("avgTicket", reportKeys.table.avgTicket, "money"),
	column("itemsPerTicket", reportKeys.table.itemsPerTicket, "ratio"),
	column("avgItemPrice", reportKeys.table.avgItemPrice, "money"),
];

function ratioCells(
	row: ReturnType<typeof totalsOf>,
): Readonly<Record<string, number | null>> {
	return {
		avgTicket: row?.avg_ticket ?? null,
		itemsPerTicket: row?.items_per_ticket ?? null,
		avgItemPrice: row?.avg_item_price ?? null,
	};
}

export function buildWeekAvgTicketCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const rows = compareRows(input);
	const average = weekAverage(input);
	const comparisons = weekComparisons(
		input,
		(row) => row.avg_ticket,
		average,
		"avgTicket",
	);
	const previous = comparisonOf(comparisons, "previous");
	const current = pickFrom(
		totalsOf(rows, null, "current"),
		(row) => row.avg_ticket,
	);
	const against = decompositionAgainst(comparisons);
	const inputs =
		against === null ? null : decompositionInputs(rows, coverage, against);
	const split =
		against === null || inputs === null
			? null
			: decomposition(
					"avg_ticket",
					against.kind === "previous" ? "previous" : "last_year",
					against.basis,
					decomposeTicket(inputs.current, inputs.reference),
				);
	const values: Record<string, TypedValue> = { period: weekValue(context) };
	if (current !== null) values.value = numberValue("money", current);
	return {
		id: "avg_ticket",
		titleKey: weekKeys.avgTicket.title,
		subtitle: null,
		metricId: "avg_ticket",
		relatedMetricIds: ["items_per_ticket", "avg_item_price"],
		headline: {
			value: current,
			unit: "money",
			caption: partialCaption(context),
		},
		comparisons,
		decomposition: split,
		narrative: narrate({
			main: {
				up: weekKeys.avgTicket.up,
				down: weekKeys.avgTicket.down,
				flat: weekKeys.avgTicket.flat,
				noReference: weekKeys.avgTicket.noReference,
				noData: weekKeys.avgTicket.noData,
			},
			values,
			current,
			comparison: previous,
			notes: weekNotes(input, previous, false),
			drivers: [],
			decomposition: split,
			references: comparisons,
		}),
		tables: [
			periodRowsTable(
				weekKeys.avgTicket.table,
				input,
				average,
				ratioColumns,
				ratioCells,
				{
					avgTicket: average.reference.avgTicket,
					itemsPerTicket: average.reference.itemsPerTicket,
					avgItemPrice: average.reference.avgItemPrice,
				},
			),
		],
		chart: null,
		notice: current === null ? noDataNotice() : null,
		markers: weekMarkers(input, false),
		csvName: weekCsvName(context, "avg_ticket"),
	};
}

export const avgTicketCard: CardDefinition = {
	id: "avg_ticket",
	needs: weekNeeds.totals,
	visible: () => true,
	build: buildWeekAvgTicketCard,
};
