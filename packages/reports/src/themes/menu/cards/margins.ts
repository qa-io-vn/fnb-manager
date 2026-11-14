import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	type MarginRow,
	menuCalls,
	menuCsvName,
	menuNeeds,
} from "../support.js";

const RATE_DIGITS = 6;
const MONEY_DIGITS = 2;

function sum(
	rows: readonly MarginRow[],
	pick: (row: MarginRow) => number | null,
): number {
	return rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
}

function marginsTable(rows: readonly MarginRow[]): TableModel {
	return tableModel({
		captionKey: menuKeys.margins.table,
		columns: [
			column("item", reportKeys.table.item, "text"),
			column("quantity", reportKeys.table.quantity, "decimal"),
			column("costedQuantity", menuKeys.table.costedQuantity, "decimal"),
			column("costedNet", menuKeys.table.costedNet, "money"),
			column("cost", menuKeys.table.cost, "money"),
			column("unitCost", menuKeys.table.unitCost, "money"),
			column("margin", menuKeys.table.margin, "money"),
			column("marginRate", menuKeys.table.marginRate, "percent"),
			column("coverage", menuKeys.table.coverage, "percent"),
		],
		rows: rows.map((row) => ({
			id: row.item_external_id,
			cells: {
				item: row.item_name ?? row.item_external_id,
				quantity: row.quantity,
				costedQuantity: row.costed_quantity,
				costedNet: row.costed_net_amount,
				cost: row.cost_amount,
				unitCost: ratio(row.cost_amount, row.costed_quantity, MONEY_DIGITS),
				margin: row.margin_amount,
				marginRate: row.margin_rate,
				coverage: row.cost_coverage,
			},
		})),
		initialSort: { key: "margin", direction: "descending" },
	});
}

export function buildMarginsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const all = input.results.rows(menuCalls.margins, "item_margins") ?? [];
	const costed = all.filter((row) => row.costed_quantity > 0);
	const costedNet = sum(costed, (row) => row.costed_net_amount);
	const margin = sum(costed, (row) => row.margin_amount);
	const itemNet = sum(all, (row) => row.net_amount);
	const rate =
		costed.length === 0 ? null : ratio(margin, costedNet, RATE_DIGITS);
	const partial = costed.some((row) => row.costed_quantity < row.quantity);
	const costedItemsNet = sum(costed, (row) => row.net_amount);
	const narrative: SentencePart[] =
		all.length === 0
			? [part(menuKeys.margins.noData, { range: rangeValue(context) })]
			: rate === null
				? [part(menuKeys.margins.noCost)]
				: [
						part(menuKeys.margins.rate, {
							rate: numberValue("percent", rate),
							items: numberValue("count", costed.length),
							share: numberValue(
								"percent",
								ratio(costedItemsNet, itemNet, RATE_DIGITS) ?? 0,
							),
						}),
					];
	const notice: NoticeModel | null =
		all.length > 0 && costed.length === 0
			? {
					tone: "info",
					part: part(menuKeys.margins.noCostNotice),
					action: "settings_costs",
				}
			: partial
				? {
						tone: "info",
						part: part(menuKeys.margins.partial, {
							share: numberValue(
								"percent",
								ratio(costedNet, costedItemsNet, RATE_DIGITS) ?? 0,
							),
						}),
						action: "settings_costs",
					}
				: null;
	return {
		id: "margins",
		titleKey: menuKeys.margins.title,
		subtitle: null,
		metricId: "gross_margin_rate",
		relatedMetricIds: ["cost_coverage"],
		headline: { value: rate, unit: "fraction", caption: null },
		comparisons: [],
		decomposition: null,
		narrative,
		tables: costed.length === 0 ? [] : [marginsTable(costed)],
		chart: null,
		notice,
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "margins"),
	};
}

export const menuMarginsCard: ThemeCardDefinition = {
	id: "margins",
	needs: menuNeeds.margins,
	visible: () => true,
	build: buildMarginsCard,
};
