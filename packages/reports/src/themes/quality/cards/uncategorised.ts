import type {
	CardModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { qualityKeys } from "../keys.js";
import {
	isTypeWithoutRole,
	isUncategorisedItem,
	itemRows,
	type QualityItemRow,
	qualityCsvName,
	qualityNeeds,
	shareOf,
	sumOf,
} from "../support.js";

export interface TypeWithoutRole {
	readonly id: string;
	readonly name: string;
	readonly items: number;
	readonly netAmount: number;
}

export function typesWithoutRole(
	rows: readonly QualityItemRow[],
): TypeWithoutRole[] {
	const byType = new Map<string, TypeWithoutRole>();
	for (const row of rows.filter(isTypeWithoutRole)) {
		const typeId = row.item_type_external_id ?? "";
		const id = `${row.pos_account_id ?? ""}|${typeId}`;
		const known = byType.get(id);
		byType.set(id, {
			id,
			name: known?.name ?? row.item_type_name ?? typeId,
			items: (known?.items ?? 0) + 1,
			netAmount: (known?.netAmount ?? 0) + row.net_amount,
		});
	}
	return [...byType.values()].sort(
		(left, right) =>
			right.netAmount - left.netAmount || left.id.localeCompare(right.id),
	);
}

function itemsTable(
	rows: readonly QualityItemRow[],
	itemNet: number,
): TableModel {
	return tableModel({
		captionKey: qualityKeys.uncategorised.itemsTable,
		columns: [
			column("item", reportKeys.table.item, "text"),
			column("posType", qualityKeys.table.posType, "text"),
			column("quantity", reportKeys.table.quantity, "decimal"),
			column("netAmount", reportKeys.table.netAmount, "money"),
			column("share", qualityKeys.table.itemShare, "percent"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: rows.map((row) => ({
			id: `${row.pos_account_id ?? ""}|${row.item_external_id}`,
			cells: {
				item: row.item_name ?? row.item_external_id,
				posType: row.pos_type_name ?? row.pos_type_external_id,
				quantity: row.quantity,
				netAmount: row.net_amount,
				share: shareOf(row.net_amount, itemNet),
				fix: qualityKeys.fix.pos.category,
			},
		})),
		initialSort: { key: "netAmount", direction: "descending" },
		previewRows: 10,
	});
}

function typesTable(
	types: readonly TypeWithoutRole[],
	itemNet: number,
): TableModel {
	return tableModel({
		captionKey: qualityKeys.uncategorised.typesTable,
		columns: [
			column("category", reportKeys.table.category, "text"),
			column("items", qualityKeys.table.items, "count"),
			column("netAmount", reportKeys.table.netAmount, "money"),
			column("share", qualityKeys.table.itemShare, "percent"),
			column("fix", qualityKeys.table.fix, "message"),
		],
		rows: types.map((type) => ({
			id: type.id,
			cells: {
				category: type.name,
				items: type.items,
				netAmount: type.netAmount,
				share: shareOf(type.netAmount, itemNet),
				fix: qualityKeys.fix.settings.role,
			},
		})),
		initialSort: { key: "netAmount", direction: "descending" },
	});
}

function noticeOf(items: number, types: number): NoticeModel | null {
	if (items > 0 && types > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.uncategorised.bothNotice),
			action: "settings_categories",
			secondaryAction: "settings_roles",
		};
	}
	if (items > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.uncategorised.itemsNotice),
			action: "settings_categories",
		};
	}
	if (types > 0) {
		return {
			tone: "info",
			part: part(qualityKeys.uncategorised.rolesNotice),
			action: "settings_roles",
		};
	}
	return null;
}

export function buildUncategorisedCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const all = itemRows(input.results);
	const sold = all.filter((row) => !row.catalogue_modifier);
	const itemNet = sumOf(sold, (row) => row.net_amount);
	const uncategorised = sold.filter(isUncategorisedItem);
	const types = typesWithoutRole(sold);
	const range = rangeValue(context);
	const narrative: SentencePart[] =
		sold.length === 0
			? [part(qualityKeys.uncategorised.noData, { range })]
			: [
					uncategorised.length === 0
						? part(qualityKeys.uncategorised.none, { range })
						: part(qualityKeys.uncategorised.main, {
								range,
								count: numberValue("count", uncategorised.length),
								share: numberValue(
									"percent",
									shareOf(
										sumOf(uncategorised, (row) => row.net_amount),
										itemNet,
									) ?? 0,
								),
							}),
					types.length === 0
						? part(qualityKeys.uncategorised.rolesNone)
						: part(qualityKeys.uncategorised.roles, {
								count: numberValue("count", types.length),
								share: numberValue(
									"percent",
									shareOf(
										sumOf(types, (type) => type.netAmount),
										itemNet,
									) ?? 0,
								),
							}),
				];
	const tables: TableModel[] = [];
	if (uncategorised.length > 0) tables.push(itemsTable(uncategorised, itemNet));
	if (types.length > 0) tables.push(typesTable(types, itemNet));
	return {
		id: "uncategorised",
		titleKey: qualityKeys.uncategorised.title,
		subtitle: null,
		metricId: "uncategorised_items",
		relatedMetricIds: [],
		headline: {
			value: sold.length === 0 ? null : uncategorised.length,
			unit: "count",
			caption: null,
		},
		comparisons: [],
		decomposition: null,
		narrative,
		tables,
		chart: null,
		notice: noticeOf(uncategorised.length, types.length),
		markers: themeMarkers(input, true),
		csvName: qualityCsvName(context, "uncategorised"),
	};
}

export const qualityUncategorisedCard: ThemeCardDefinition = {
	id: "uncategorised",
	needs: qualityNeeds.uncategorised,
	wide: true,
	visible: () => true,
	build: buildUncategorisedCard,
};
