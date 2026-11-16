import type { CardModel, TableModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	COST_TABLE_ITEMS,
	isUncostedItem,
	itemRows,
	type QualityItemRow,
	type QualityMarginRow,
	qualityCalls,
	qualityCsvName,
	qualityNeeds,
	shareOf,
	sumOf,
} from "../support.js";

function costsTable(
	rows: readonly QualityItemRow[],
	itemNet: number,
): TableModel {
	return tableModel({
		captionKey: qualityKeys.costs.table,
		columns: [
			column("item", reportKeys.table.item, "text"),
			column("quantity", reportKeys.table.quantity, "decimal"),
			column("netAmount", reportKeys.table.netAmount, "money"),
			column("share", qualityKeys.table.itemShare, "percent"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: rows.map((row) => ({
			id: `${row.pos_account_id ?? ""}|${row.item_external_id}`,
			cells: {
				item: row.item_name ?? row.item_external_id,
				quantity: row.quantity,
				netAmount: row.net_amount,
				share: shareOf(row.net_amount, itemNet),
				fix: qualityKeys.fix.settings.cost,
			},
		})),
		initialSort: { key: "netAmount", direction: "descending" },
		previewRows: 10,
	});
}

export function largestUncosted(
	rows: readonly QualityItemRow[],
): QualityItemRow[] {
	return rows
		.filter(isUncostedItem)
		.sort(
			(left, right) =>
				right.net_amount - left.net_amount ||
				left.item_external_id.localeCompare(right.item_external_id),
		)
		.slice(0, COST_TABLE_ITEMS);
}

export function costedShare(rows: readonly QualityMarginRow[]): number | null {
	if (rows.length === 0) return null;
	return shareOf(
		sumOf(rows, (row) => row.costed_net_amount),
		sumOf(rows, (row) => row.net_amount),
	);
}

export function buildCostsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const sold = itemRows(input.results).filter((row) => !row.catalogue_modifier);
	const itemNet = sumOf(sold, (row) => row.net_amount);
	const uncosted = sold.filter(isUncostedItem);
	const coverage = costedShare(
		input.results.rows(qualityCalls.margins, "item_margins") ?? [],
	);
	const range = rangeValue(context);
	const narrative: SentencePart[] = [];
	if (coverage !== null) {
		narrative.push(
			part(qualityKeys.costs.coverage, {
				range,
				coverage: numberValue("percent", coverage),
			}),
		);
	}
	if (sold.length > 0) {
		narrative.push(
			uncosted.length === 0
				? part(qualityKeys.costs.none)
				: part(qualityKeys.costs.main, {
						count: numberValue("count", uncosted.length),
						share: numberValue(
							"percent",
							shareOf(
								sumOf(uncosted, (row) => row.net_amount),
								itemNet,
							) ?? 0,
						),
					}),
		);
	}
	if (narrative.length === 0) {
		narrative.push(part(qualityKeys.costs.noData, { range }));
	}
	const missing = uncosted.length > 0 || (coverage !== null && coverage < 1);
	return {
		id: "costs",
		titleKey: qualityKeys.costs.title,
		subtitle: null,
		metricId: "cost_coverage",
		relatedMetricIds: [],
		headline: { value: coverage, unit: "fraction", caption: null },
		comparisons: [],
		decomposition: null,
		narrative,
		tables:
			uncosted.length === 0 ? [] : [costsTable(largestUncosted(sold), itemNet)],
		chart: null,
		notice: missing
			? {
					tone: "info",
					part: part(qualityKeys.costs.notice),
					action: "settings_costs",
				}
			: null,
		markers: themeMarkers(input, true),
		csvName: qualityCsvName(context, "costs"),
	};
}

export const qualityCostsCard: ThemeCardDefinition = {
	id: "costs",
	needs: qualityNeeds.costs,
	visible: () => true,
	build: buildCostsCard,
};
