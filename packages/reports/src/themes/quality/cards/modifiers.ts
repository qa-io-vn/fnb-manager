import type { CardModel, TableModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	allStoresSummary,
	type QualitySummaryRow,
	qualityCsvName,
	qualityNeeds,
	storeSummaries,
} from "../support.js";

function modifiersTable(
	stores: readonly { name: string; row: QualitySummaryRow }[],
): TableModel {
	return tableModel({
		captionKey: qualityKeys.modifiers.table,
		columns: [
			column("store", reportKeys.table.store, "text"),
			column("itemLines", qualityKeys.table.itemLines, "count"),
			column("modifierLines", qualityKeys.table.modifierLines, "count"),
			column("share", qualityKeys.table.modifierShare, "percent"),
			column(
				"catalogueModifiers",
				qualityKeys.table.catalogueModifiers,
				"count",
			),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: stores.map(({ name, row }) => ({
			id: row.store_id ?? "",
			cells: {
				store: name,
				itemLines: row.item_lines,
				modifierLines: row.modifier_lines,
				share: row.modifier_line_share,
				catalogueModifiers: row.catalogue_modifier_lines,
				fix:
					row.catalogue_modifier_lines > 0
						? qualityKeys.fix.pos.modifier
						: null,
			},
		})),
	});
}

export function buildModifiersCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const total = allStoresSummary(input.results);
	const stores = storeSummaries(context, input.results);
	const lines = (total?.item_lines ?? 0) + (total?.modifier_lines ?? 0);
	const catalogue = total?.catalogue_modifier_lines ?? 0;
	const range = rangeValue(context);
	const narrative: SentencePart[] =
		lines === 0
			? [part(qualityKeys.modifiers.noData, { range })]
			: [
					part(qualityKeys.modifiers.main, {
						range,
						share: numberValue("percent", total?.modifier_line_share ?? 0),
					}),
					catalogue === 0
						? part(qualityKeys.modifiers.catalogueNone)
						: part(qualityKeys.modifiers.catalogue, {
								count: numberValue("count", catalogue),
							}),
				];
	return {
		id: "modifiers",
		titleKey: qualityKeys.modifiers.title,
		subtitle: null,
		metricId: "modifier_line_share",
		relatedMetricIds: [],
		headline: {
			value: lines === 0 ? null : (total?.modifier_line_share ?? null),
			unit: "fraction",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables: stores.length === 0 || lines === 0 ? [] : [modifiersTable(stores)],
		chart: null,
		notice:
			catalogue === 0
				? null
				: {
						tone: "warning",
						part: part(qualityKeys.fix.pos.modifier),
						action: null,
					},
		markers: themeMarkers(input, false),
		csvName: qualityCsvName(context, "modifiers"),
	};
}

export const qualityModifiersCard: ThemeCardDefinition = {
	id: "modifiers",
	needs: qualityNeeds.modifiers,
	visible: () => true,
	build: buildModifiersCard,
};
