import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, NoticeModel } from "../../../model/card.js";
import {
	comparisonsFromMetricRows,
	withUnit,
} from "../../../model/comparison.js";
import { groupRows, SHARE_DIGITS } from "../../../model/grouping.js";
import { sumQuantity } from "../../../model/money.js";
import { type DriverCandidate, narrate } from "../../../model/narrative.js";
import { difference, ratio } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	comparisonOf,
	type ItemRow,
	itemRows,
	likeForLikeMetrics,
	metricRows,
	metricValueOf,
	monthCsvName,
	monthLabels,
	monthMarkers,
	monthNeeds,
	monthValue,
	pointsValue,
} from "../support.js";

export const SIZE_METRIC = "size_l_share";
export const LARGE_SIZE_LABEL = "L";
export const SIZE_CHART_DRINKS = 10;
export const MIN_DRIVER_QUANTITY = 10;

export interface SizeGroup {
	readonly drink: string;
	readonly largeQuantity: number;
	readonly sizedQuantity: number;
	readonly previousSizedQuantity: number;
	readonly largeShare: number | null;
	readonly previousShare: number | null;
	readonly change: number | null;
}

function isLarge(row: ItemRow): boolean {
	return row.size_label === LARGE_SIZE_LABEL;
}

export function sizeGroups(rows: readonly ItemRow[]): SizeGroup[] {
	const sized = rows.filter((row) => row.size_label !== null);
	const groups = groupRows(sized, (row) => row.base_name ?? row.item_name);
	return [...groups.entries()]
		.map(([drink, items]) => {
			const largeQuantity = sumQuantity(
				items.filter(isLarge).map((row) => row.quantity),
			);
			const sizedQuantity = sumQuantity(items.map((row) => row.quantity));
			const previousLarge = sumQuantity(
				items.filter(isLarge).map((row) => row.compare_quantity),
			);
			const previousSized = sumQuantity(
				items.map((row) => row.compare_quantity),
			);
			const largeShare = ratio(largeQuantity, sizedQuantity, SHARE_DIGITS);
			const previousShare = ratio(previousLarge, previousSized, SHARE_DIGITS);
			return {
				drink,
				largeQuantity,
				sizedQuantity,
				previousSizedQuantity: previousSized,
				largeShare,
				previousShare,
				change: difference(largeShare, previousShare),
			};
		})
		.filter((group) => group.sizedQuantity > 0 || group.previousShare !== null)
		.sort(
			(left, right) =>
				right.sizedQuantity - left.sizedQuantity ||
				(left.drink < right.drink ? -1 : left.drink > right.drink ? 1 : 0),
		);
}

export function drinkDrivers(groups: readonly SizeGroup[]): DriverCandidate[] {
	return groups.flatMap((group) =>
		group.change === null ||
		group.sizedQuantity < MIN_DRIVER_QUANTITY ||
		group.previousSizedQuantity < MIN_DRIVER_QUANTITY
			? []
			: [
					{
						dimension: "item" as const,
						label: textValue("text", group.drink),
						contribution: group.change,
						unit: "fraction" as const,
					},
				],
	);
}

export function buildSizeMixCard(input: CardInput): CardModel {
	const { context, coverage } = input;
	const metrics = metricRows(input);
	const current = metricValueOf(metrics, SIZE_METRIC, "current");
	const comparisons = withUnit(
		comparisonsFromMetricRows({
			all: metrics,
			likeForLike: likeForLikeMetrics(input),
			coverage,
			metricId: SIZE_METRIC,
			kinds: ["previous", "last_year"],
			labels: monthLabels(),
		}),
		"fraction",
	);
	const groups = sizeGroups(itemRows(input));
	const values: Record<string, TypedValue> = { month: monthValue(context) };
	if (current !== null) values.value = numberValue("percent", current);
	const points = pointsValue(comparisonOf(comparisons, "previous"));
	if (points !== null) values.points = points;
	const notice: NoticeModel | null =
		current === null
			? { tone: "info", part: part(monthKeys.size.notMeasured), action: null }
			: null;
	const chartGroups = groups
		.filter((group) => group.sizedQuantity > 0)
		.slice(0, SIZE_CHART_DRINKS);
	return {
		id: "size_mix",
		titleKey: monthKeys.size.title,
		subtitle: null,
		metricId: SIZE_METRIC,
		relatedMetricIds: [],
		headline: { value: current, unit: "fraction", caption: null },
		comparisons,
		decomposition: null,
		narrative: narrate({
			main: {
				up: monthKeys.size.up,
				down: monthKeys.size.down,
				flat: monthKeys.size.flat,
				noReference: monthKeys.size.noReference,
				noData: monthKeys.size.noData,
			},
			values,
			current,
			comparison: comparisonOf(comparisons, "previous"),
			notes: [],
			drivers: drinkDrivers(groups),
			decomposition: null,
		}),
		tables: [
			tableModel({
				captionKey: monthKeys.size.table,
				columns: [
					column("drink", monthKeys.table.drink, "text"),
					column("largeQuantity", monthKeys.table.largeQuantity, "decimal"),
					column("sizedQuantity", monthKeys.table.sizedQuantity, "decimal"),
					column("largeShare", monthKeys.table.largeShare, "percent"),
					column(
						"previousShare",
						monthKeys.table.previousMonthShare,
						"percent",
					),
					column("change", monthKeys.table.changePoints, "percentPoints"),
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
			}),
		],
		chart:
			chartGroups.length === 0
				? null
				: {
						labelKey: monthKeys.size.chart,
						categories: chartGroups.map((group) =>
							textValue("text", group.drink),
						),
						series: [
							{
								label: part(monthKeys.table.largeShare),
								kind: "bar",
								tone: "primary",
								axis: "left",
								stack: null,
								values: chartGroups.map((group) => group.largeShare),
							},
						],
						leftUnit: "fraction",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice,
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "size_mix"),
	};
}

export const sizeMixCard: CardDefinition = {
	id: "size_mix",
	needs: monthNeeds.size,
	visible: () => true,
	build: buildSizeMixCard,
};
