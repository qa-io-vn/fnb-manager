import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, NoticeModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	type ItemRow,
	itemRows,
	monthCalls,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthRanges,
	monthValue,
} from "../support.js";

export interface RankedItem {
	readonly row: ItemRow;
	readonly rank: number;
}

export interface NewItems {
	readonly state: "measured" | "too_young";
	readonly basis: "all_stores" | "like_for_like";
	readonly covered: number;
	readonly total: number;
	readonly sold: number;
	readonly items: readonly RankedItem[];
}

export function newItemsOf(input: CardInput): NewItems {
	const ranges = monthRanges(input.context);
	const coverage = input.coverage.forReference(ranges.previousStart);
	const base = {
		covered: coverage.coveredStoreIds.length,
		total: coverage.storeCount,
	};
	if (coverage.state === "none") {
		return {
			...base,
			state: "too_young",
			basis: "all_stores",
			sold: 0,
			items: [],
		};
	}
	const partial = coverage.state === "partial";
	const rows = partial
		? (input.results.rows(monthCalls.itemsCovered, "item_summary") ?? [])
		: itemRows(input);
	const ranked = rows
		.filter((row) => row.quantity > 0)
		.map((row, index) => ({ row, rank: index + 1 }));
	return {
		...base,
		state: "measured",
		basis: partial ? "like_for_like" : "all_stores",
		sold: ranked.length,
		items: ranked.filter(
			({ row }) =>
				row.first_sold_on !== null && row.first_sold_on >= ranges.monthStart,
		),
	};
}

function narrativeOf(input: CardInput, found: NewItems): SentencePart[] {
	const month = monthValue(input.context);
	if (found.state === "too_young") {
		return [part(monthKeys.newItems.unknown, { month })];
	}
	const best = found.items[0];
	const parts: SentencePart[] =
		best === undefined
			? [part(monthKeys.newItems.none, { month })]
			: [
					part(monthKeys.newItems.main, {
						month,
						count: numberValue("count", found.items.length),
						item: textValue("text", best.row.item_name),
						rank: numberValue("count", best.rank),
						total: numberValue("count", found.sold),
					}),
				];
	if (found.basis === "like_for_like") {
		parts.push(
			part(reportKeys.clause.coverage.likeForLike, {
				covered: numberValue("count", found.covered),
				total: numberValue("count", found.total),
			}),
		);
	}
	return parts;
}

export function buildNewItemsCard(input: CardInput): CardModel {
	const { context } = input;
	const found = newItemsOf(input);
	const best = found.items[0];
	const notice: NoticeModel | null =
		found.state === "too_young"
			? { tone: "info", part: part(monthKeys.newItems.tooYoung), action: null }
			: null;
	return {
		id: "new_items",
		titleKey: monthKeys.newItems.title,
		subtitle: null,
		metricId: "new_item_count",
		relatedMetricIds: ["item_net"],
		headline: {
			value: found.state === "too_young" ? null : found.items.length,
			unit: "count",
			caption:
				best === undefined
					? null
					: part(monthKeys.newItems.caption, {
							item: textValue("text", best.row.item_name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(input, found),
		tables: [
			tableModel({
				captionKey: monthKeys.newItems.table,
				columns: [
					column("item", reportKeys.table.item, "text"),
					column("firstSold", monthKeys.table.firstSold, "date"),
					column("quantity", reportKeys.table.quantity, "decimal"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("rank", monthKeys.table.rank, "count"),
				],
				rows: found.items.map(({ row, rank }) => ({
					id: row.item_external_id,
					cells: {
						item: row.item_name,
						firstSold: row.first_sold_on,
						quantity: row.quantity,
						net: row.net_amount,
						share: row.net_share,
						rank,
					},
				})),
			}),
		],
		chart: null,
		notice,
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "new_items"),
	};
}

export const newItemsCard: CardDefinition = {
	id: "new_items",
	needs: monthNeeds.newItems,
	visible: () => true,
	build: buildNewItemsCard,
};
