import type {
	CardModel,
	ChartModel,
	NoticeModel,
} from "../../../model/card.js";
import { reportKeys, roleKey } from "../../../model/keys.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { column, tableModel } from "../../../model/tables.js";
import { numberValue, part, type TypedValue } from "../../../model/values.js";
import {
	type CategoryShare,
	categoryLabel,
	categoryShares,
} from "../../../reports/week/cards/category-mix.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import { type ItemRow, menuCalls, menuCsvName, menuNeeds } from "../support.js";

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
		labelKey: menuKeys.categoryMix.chart,
		categories: categories.map(categoryLabel),
		series: [
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: categories.map((category) => category.share),
			},
			{
				label: part(reportKeys.periodRow.previous),
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

function uncategorisedNotice(rows: readonly ItemRow[]): NoticeModel | null {
	const items = rows.filter(
		(row) =>
			row.item_type_external_id === null &&
			(row.quantity !== 0 || row.net_amount !== 0),
	).length;
	if (items === 0) return null;
	return {
		tone: "info",
		part: part(menuKeys.categoryMix.uncategorised, {
			items: numberValue("count", items),
		}),
		action: "settings_categories",
	};
}

export function buildCategoryMixCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = input.results.rows(menuCalls.items, "item_summary") ?? [];
	const categories = categoryShares(rows).filter(
		(category) => category.net !== 0 || category.compareNet !== 0,
	);
	const leader =
		categories.find(
			(category) => category.share !== null && category.net > 0,
		) ?? null;
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (leader !== null) {
		values.category = categoryLabel(leader);
		values.share = numberValue("percent", leader.share ?? 0);
	}
	return {
		id: "category_mix",
		titleKey: menuKeys.categoryMix.title,
		subtitle: null,
		metricId: "category_net_share",
		relatedMetricIds: [],
		headline: {
			value: leader?.share ?? null,
			unit: "fraction",
			caption:
				leader === null
					? null
					: part(menuKeys.categoryMix.caption, {
							category: categoryLabel(leader),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrate({
			main: {
				up: menuKeys.categoryMix.main,
				down: menuKeys.categoryMix.main,
				flat: menuKeys.categoryMix.main,
				noReference: menuKeys.categoryMix.main,
				noData: menuKeys.categoryMix.noData,
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
				captionKey: menuKeys.categoryMix.table,
				columns: [
					column("category", reportKeys.table.category, "label"),
					column("role", reportKeys.table.role, "message"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("previousShare", menuKeys.table.previousShare, "percent"),
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
						previousShare: category.lastWeekShare,
						shareChange: category.shareChange,
						quantity: category.quantity,
					},
				})),
				initialSort: { key: "net", direction: "descending" },
			}),
		],
		chart: chartOf(categories),
		notice: uncategorisedNotice(rows),
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "category_mix"),
	};
}

export const menuCategoryMixCard: ThemeCardDefinition = {
	id: "category_mix",
	needs: menuNeeds.categoryMix,
	visible: () => true,
	build: buildCategoryMixCard,
};
