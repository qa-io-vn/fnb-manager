import type {
	CardModel,
	ChartModel,
	NoticeModel,
} from "../../../model/card.js";
import { SHARE_DIGITS } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { sumQuantity } from "../../../model/money.js";
import { narrate } from "../../../model/narrative.js";
import { ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import {
	drinkDrivers,
	LARGE_SIZE_LABEL,
	SIZE_CHART_DRINKS,
	SIZE_METRIC,
	type SizeGroup,
	sizeGroups,
} from "../../../reports/month/cards/size-mix.js";
import { pointsValue } from "../../../reports/month/support.js";
import {
	referenceLabel,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { menuKeys } from "../keys.js";
import {
	type ComparedValues,
	type ItemRow,
	MENU_PREVIEW_ROWS,
	menuCalls,
	menuComparison,
	menuCsvName,
	menuNeeds,
} from "../support.js";

function largeShare(
	rows: readonly ItemRow[],
	pick: (row: ItemRow) => number | null,
): number | null {
	const sized = rows.filter((row) => row.size_label !== null);
	const large = sized.filter((row) => row.size_label === LARGE_SIZE_LABEL);
	return ratio(
		sumQuantity(large.map(pick)),
		sumQuantity(sized.map(pick)),
		SHARE_DIGITS,
	);
}

function sharesOf(rows: readonly ItemRow[]): ComparedValues {
	return {
		current: largeShare(rows, (row) => row.quantity),
		reference: largeShare(rows, (row) => row.compare_quantity),
	};
}

function chartOf(groups: readonly SizeGroup[]): ChartModel | null {
	const shown = groups
		.filter((group) => group.sizedQuantity > 0)
		.slice(0, SIZE_CHART_DRINKS);
	if (shown.length === 0) return null;
	return {
		labelKey: menuKeys.sizeMix.chart,
		categories: shown.map((group) => textValue("text", group.drink)),
		series: [
			{
				label: part(reportKeys.periodRow.current),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: shown.map((group) => group.largeShare),
			},
			{
				label: part(reportKeys.periodRow.previous),
				kind: "bar",
				tone: "muted",
				axis: "left",
				stack: null,
				values: shown.map((group) => group.previousShare),
			},
		],
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildSizeMixCard(input: ThemeCardInput): CardModel {
	const { context, coverage } = input;
	const rows = input.results.rows(menuCalls.items, "item_summary") ?? [];
	const all = sharesOf(rows);
	const previous = menuComparison({
		coverage,
		range: context.range.previous,
		label: referenceLabel(context.range, "previous"),
		all,
		covered: () =>
			sharesOf(
				input.results.rows(menuCalls.itemsCovered, "item_summary") ?? [],
			),
		unit: "fraction",
	});
	const groups = sizeGroups(rows);
	const values: Record<string, TypedValue> = { range: rangeValue(context) };
	if (all.current !== null) values.value = numberValue("percent", all.current);
	const points = pointsValue(previous);
	if (points !== null) values.points = points;
	const notice: NoticeModel | null =
		all.current === null
			? { tone: "info", part: part(menuKeys.sizeMix.none), action: null }
			: null;
	return {
		id: "size_mix",
		titleKey: menuKeys.sizeMix.title,
		subtitle: null,
		metricId: SIZE_METRIC,
		relatedMetricIds: [],
		headline: { value: all.current, unit: "fraction", caption: null },
		comparisons: [previous],
		decomposition: null,
		narrative: narrate({
			main: {
				up: menuKeys.sizeMix.up,
				down: menuKeys.sizeMix.down,
				flat: menuKeys.sizeMix.flat,
				noReference: menuKeys.sizeMix.noReference,
				noData: menuKeys.sizeMix.noData,
			},
			values,
			current: all.current,
			comparison: previous,
			notes: [],
			drivers: drinkDrivers(groups),
			decomposition: null,
		}),
		tables: [
			tableModel({
				captionKey: menuKeys.sizeMix.table,
				columns: [
					column("drink", menuKeys.table.drink, "text"),
					column("largeQuantity", menuKeys.table.largeQuantity, "decimal"),
					column("sizedQuantity", menuKeys.table.sizedQuantity, "decimal"),
					column("largeShare", menuKeys.table.largeShare, "percent"),
					column("previousShare", menuKeys.table.previousShare, "percent"),
					column("change", reportKeys.table.changePoints, "percentPoints"),
				],
				rows: groups.map((group) => ({
					id: group.drink,
					cells: {
						drink: group.drink,
						largeQuantity: group.largeQuantity,
						sizedQuantity: group.sizedQuantity,
						largeShare: group.largeShare,
						previousShare: group.previousShare,
						change: group.change,
					},
				})),
				initialSort: { key: "sizedQuantity", direction: "descending" },
				previewRows: MENU_PREVIEW_ROWS,
			}),
		],
		chart: chartOf(groups),
		notice,
		markers: themeMarkers(input, true),
		csvName: menuCsvName(context, "size_mix"),
	};
}

export const menuSizeMixCard: ThemeCardDefinition = {
	id: "size_mix",
	needs: menuNeeds.sizeMix,
	visible: () => true,
	build: buildSizeMixCard,
};
