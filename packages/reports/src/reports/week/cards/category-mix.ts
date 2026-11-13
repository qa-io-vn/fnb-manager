import type { AnalyticsRow } from "../../../contract/functions.js";
import type { ItemTypeRole } from "../../../contract/values.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, ChartModel } from "../../../model/card.js";
import { groupRows } from "../../../model/grouping.js";
import { reportKeys, roleKey } from "../../../model/keys.js";
import { sumMoney, sumQuantity } from "../../../model/money.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { weekKeys } from "../keys.js";
import {
	noDataNotice,
	weekCalls,
	weekCsvName,
	weekMarkers,
	weekNeeds,
	weekValue,
} from "../support.js";

type ItemRow = AnalyticsRow<"item_summary">;

export const SHARE_DIGITS = 6;
export const UNCATEGORISED_ID = "uncategorised";
const TYPE_ID_PREFIX = "type:";

export interface CategoryShare {
	readonly id: string;
	readonly typeId: string | null;
	readonly name: string | null;
	readonly role: ItemTypeRole | null;
	readonly net: number;
	readonly compareNet: number;
	readonly quantity: number;
	readonly share: number | null;
	readonly lastWeekShare: number | null;
	readonly shareChange: number | null;
}

function firstPresent<Value>(values: readonly (Value | null)[]): Value | null {
	for (const value of values) if (value !== null) return value;
	return null;
}

export function categoryShares(rows: readonly ItemRow[]): CategoryShare[] {
	const total = sumMoney(rows.map((row) => row.net_amount));
	const compareTotal = sumMoney(rows.map((row) => row.compare_net_amount));
	const hasCompare = rows.some((row) => row.compare_net_amount !== null);
	const groups = groupRows(rows, (row) =>
		row.item_type_external_id === null
			? UNCATEGORISED_ID
			: `${TYPE_ID_PREFIX}${row.item_type_external_id}`,
	);
	return [...groups.entries()]
		.map(([id, members]) => {
			const net = sumMoney(members.map((row) => row.net_amount));
			const compareNet = sumMoney(members.map((row) => row.compare_net_amount));
			const share = ratio(net, total, SHARE_DIGITS);
			const lastWeekShare = hasCompare
				? ratio(compareNet, compareTotal, SHARE_DIGITS)
				: null;
			const typeId = members[0]?.item_type_external_id ?? null;
			return {
				id,
				typeId,
				name: firstPresent(members.map((row) => row.item_type_name)),
				role: firstPresent(members.map((row) => row.role)),
				net,
				compareNet,
				quantity: sumQuantity(members.map((row) => row.quantity)),
				share,
				lastWeekShare,
				shareChange: difference(share, lastWeekShare),
			};
		})
		.sort(
			(left, right) =>
				right.net - left.net ||
				(left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
		);
}

export function categoryLabel(category: CategoryShare): TypedValue {
	if (category.typeId === null) {
		return messageValue(reportKeys.label.uncategorised);
	}
	return textValue("text", category.name ?? category.typeId);
}

function categoryCell(category: CategoryShare): string {
	return category.typeId === null
		? reportKeys.label.uncategorised
		: (category.name ?? category.typeId);
}

function drivers(categories: readonly CategoryShare[]): DriverCandidate[] {
	return categories.flatMap((category) =>
		category.shareChange === null
			? []
			: [
					{
						dimension: "category" as const,
						label: categoryLabel(category),
						contribution: category.shareChange,
						unit: "fraction" as const,
					},
				],
	);
}

function chartOf(categories: readonly CategoryShare[]): ChartModel | null {
	if (categories.length === 0) return null;
	return {
		labelKey: weekKeys.categories.chart,
		categories: categories.map(categoryLabel),
		series: [
			{
				label: part(weekKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: categories.map((category) => category.share),
			},
			{
				label: part(weekKeys.periodRow.previous),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: categories.map((category) => category.lastWeekShare),
			},
		],
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildCategoryMixCard(input: CardInput): CardModel {
	const { context } = input;
	const rows = input.results.rows(weekCalls.items, "item_summary") ?? [];
	const categories = categoryShares(rows).filter(
		(category) => category.net !== 0 || category.compareNet !== 0,
	);
	const leader =
		categories.find(
			(category) => category.share !== null && category.net > 0,
		) ?? null;
	const values: Record<string, TypedValue> = { period: weekValue(context) };
	if (leader !== null) {
		values.category = categoryLabel(leader);
		values.share = numberValue("percent", leader.share ?? 0);
	}
	return {
		id: "category_mix",
		titleKey: weekKeys.categories.title,
		subtitle: null,
		metricId: "category_net_share",
		relatedMetricIds: [],
		headline: {
			value: leader?.share ?? null,
			unit: "fraction",
			caption:
				leader === null
					? null
					: part(weekKeys.categories.caption, {
							category: categoryLabel(leader),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrate({
			main: {
				up: weekKeys.categories.main,
				down: weekKeys.categories.main,
				flat: weekKeys.categories.main,
				noReference: weekKeys.categories.main,
				noData: weekKeys.categories.noData,
			},
			values,
			current: leader?.share ?? null,
			comparison: null,
			notes: [],
			drivers: drivers(categories),
			decomposition: null,
		}),
		tables: [
			tableModel({
				captionKey: weekKeys.categories.table,
				columns: [
					column("category", reportKeys.table.category, "label"),
					column("role", reportKeys.table.role, "message"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("lastWeekShare", weekKeys.table.lastWeekShare, "percent"),
					column("shareChange", reportKeys.table.changePoints, "percentPoints"),
					column("quantity", reportKeys.table.quantity, "decimal"),
				],
				rows: categories.map((category) => ({
					id: category.id,
					cells: {
						category: categoryCell(category),
						role: roleKey(category.role),
						net: category.net,
						share: category.share,
						lastWeekShare: category.lastWeekShare,
						shareChange: category.shareChange,
						quantity: category.quantity,
					},
				})),
				initialSort: { key: "net", direction: "descending" },
			}),
		],
		chart: chartOf(categories),
		notice: leader === null ? noDataNotice() : null,
		markers: weekMarkers(input, true),
		csvName: weekCsvName(context, "category_mix"),
	};
}

export const categoryMixCard: CardDefinition = {
	id: "category_mix",
	needs: weekNeeds.categories,
	visible: () => true,
	build: buildCategoryMixCard,
};
