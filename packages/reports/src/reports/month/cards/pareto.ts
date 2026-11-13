import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel, ChartModel, Comparison } from "../../../model/card.js";
import {
	comparison,
	likeForLikeLabel,
	noCoverageReason,
} from "../../../model/comparison.js";
import {
	countToReach,
	cumulativeShares,
	shares,
} from "../../../model/grouping.js";
import { previousLabelKey, reportKeys } from "../../../model/keys.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
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

export const PARETO_THRESHOLD = 0.8;
export const PARETO_CHART_ITEMS = 20;

export interface ParetoEntry {
	readonly row: ItemRow;
	readonly rank: number;
	readonly share: number | null;
	readonly cumulative: number | null;
}

function byNet(
	value: (row: ItemRow) => number,
	quantity: (row: ItemRow) => number,
) {
	return (left: ItemRow, right: ItemRow) =>
		value(right) - value(left) ||
		quantity(right) - quantity(left) ||
		(left.item_external_id < right.item_external_id
			? -1
			: left.item_external_id > right.item_external_id
				? 1
				: 0);
}

export function paretoOf(
	rows: readonly ItemRow[],
	value: (row: ItemRow) => number,
	quantity: (row: ItemRow) => number,
): ParetoEntry[] {
	const sold = rows
		.filter((row) => value(row) > 0)
		.sort(byNet(value, quantity));
	const nets = sold.map(value);
	const shareValues = shares(nets);
	const cumulative = cumulativeShares(nets);
	return sold.map((row, index) => ({
		row,
		rank: index + 1,
		share: shareValues[index] ?? null,
		cumulative: cumulative[index] ?? null,
	}));
}

export function paretoCount(entries: readonly ParetoEntry[]): number | null {
	return countToReach(
		entries.map((entry) => entry.cumulative),
		PARETO_THRESHOLD,
	);
}

interface ParetoCounts {
	readonly current: number | null;
	readonly previous: number | null;
	readonly previousItems: number;
}

function countsOf(rows: readonly ItemRow[]): ParetoCounts {
	const previousEntries = paretoOf(
		rows,
		(row) => row.compare_net_amount ?? 0,
		(row) => row.compare_quantity ?? 0,
	);
	return {
		current: paretoCount(
			paretoOf(
				rows,
				(row) => row.net_amount,
				(row) => row.quantity,
			),
		),
		previous: paretoCount(previousEntries),
		previousItems: previousEntries.length,
	};
}

function coveredRows(input: CardInput): readonly ItemRow[] {
	return input.results.rows(monthCalls.itemsCovered, "item_summary") ?? [];
}

function previousComparison(
	input: CardInput,
	allStores: ParetoCounts,
): Comparison {
	const ranges = monthRanges(input.context);
	const coverage = input.coverage.forReference(ranges.previousStart);
	const label = part(previousLabelKey("month"));
	const range = { from: ranges.previousStart, to: ranges.previousEnd };
	if (coverage.state === "partial") {
		const covered = countsOf(coveredRows(input));
		return comparison({
			kind: "previous",
			label: likeForLikeLabel(label, coverage),
			range,
			current: covered.current,
			reference: covered.previous,
			basis: "like_for_like",
			coveredStores: coverage.coveredStoreIds.length,
			totalStores: coverage.storeCount,
		});
	}
	const current = allStores.current;
	if (coverage.state === "none") {
		return comparison({
			kind: "previous",
			label,
			range,
			current,
			reference: null,
			coveredStores: 0,
			totalStores: coverage.storeCount,
			unavailable: noCoverageReason(
				input.coverage,
				coverage.youngStoreIds,
				ranges.previousStart,
			),
		});
	}
	return comparison({
		kind: "previous",
		label,
		range,
		current,
		reference: allStores.previous,
		coveredStores: coverage.storeCount,
		totalStores: coverage.storeCount,
	});
}

function previousSentence(
	allStores: ParetoCounts,
	versus: Comparison,
): SentencePart | null {
	if (versus.basis === "like_for_like") {
		if (versus.current === null || versus.reference === null) return null;
		return part(monthKeys.pareto.previousLikeForLike, {
			current: numberValue("count", versus.current),
			count: numberValue("count", versus.reference),
			covered: numberValue("count", versus.coveredStores),
			stores: numberValue("count", versus.totalStores),
		});
	}
	if (allStores.previous === null) return null;
	return part(monthKeys.pareto.previous, {
		count: numberValue("count", allStores.previous),
		total: numberValue("count", allStores.previousItems),
	});
}

function paretoChart(entries: readonly ParetoEntry[]): ChartModel {
	const top = entries.slice(0, PARETO_CHART_ITEMS);
	const rest = entries.slice(PARETO_CHART_ITEMS);
	const tail = rest.at(-1);
	const categories: TypedValue[] = top.map((entry) =>
		textValue("text", entry.row.item_name),
	);
	const bars: (number | null)[] = top.map((entry) => entry.row.net_amount);
	const cumulative: (number | null)[] = top.map((entry) => entry.cumulative);
	if (tail !== undefined) {
		categories.push(messageValue(monthKeys.pareto.otherItems));
		bars.push(null);
		cumulative.push(tail.cumulative);
	}
	return {
		labelKey: monthKeys.pareto.chart,
		categories,
		series: [
			{
				label: part(reportKeys.table.netAmount),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: bars,
			},
			{
				label: part(monthKeys.table.cumulativeShare),
				kind: "line",
				tone: "secondary",
				axis: "right",
				stack: null,
				values: cumulative,
			},
		],
		leftUnit: "money",
		rightUnit: "fraction",
		markLines: [
			{
				label: part(monthKeys.pareto.line),
				value: PARETO_THRESHOLD,
				axis: "right",
			},
		],
		markAreas: [],
	};
}

export function buildParetoCard(input: CardInput): CardModel {
	const { context } = input;
	const rows = itemRows(input);
	const entries = paretoOf(
		rows,
		(row) => row.net_amount,
		(row) => row.quantity,
	);
	const allStores = countsOf(rows);
	const count = allStores.current;
	const versus = previousComparison(input, allStores);
	const second = previousSentence(allStores, versus);
	const leader = entries[0] ?? null;
	const month = monthValue(context);
	const narrative: SentencePart[] =
		count === null || leader === null
			? [part(monthKeys.pareto.noData, { month })]
			: [
					part(monthKeys.pareto.main, {
						month,
						count: numberValue("count", count),
						total: numberValue("count", entries.length),
						item: textValue("text", leader.row.item_name),
						share: numberValue("percent", leader.share ?? 0),
					}),
					...(second === null ? [] : [second]),
				];
	return {
		id: "pareto",
		titleKey: monthKeys.pareto.title,
		subtitle: null,
		metricId: "item_pareto_count",
		relatedMetricIds: ["item_net"],
		headline: {
			value: count,
			unit: "count",
			caption: count === null ? null : part(monthKeys.pareto.caption),
		},
		comparisons: [versus],
		decomposition: null,
		narrative,
		tables: [
			tableModel({
				captionKey: monthKeys.pareto.table,
				columns: [
					column("rank", monthKeys.table.rank, "count"),
					column("item", reportKeys.table.item, "text"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("cumulative", monthKeys.table.cumulativeShare, "percent"),
					column("quantity", reportKeys.table.quantity, "decimal"),
					column("previous", monthKeys.table.previousMonthNet, "money"),
				],
				rows: entries.map((entry) => ({
					id: entry.row.item_external_id,
					cells: {
						rank: entry.rank,
						item: entry.row.item_name,
						net: entry.row.net_amount,
						share: entry.share,
						cumulative: entry.cumulative,
						quantity: entry.row.quantity,
						previous: entry.row.compare_net_amount,
					},
				})),
			}),
		],
		chart: entries.length === 0 ? null : paretoChart(entries),
		notice: null,
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "pareto"),
	};
}

export const paretoCard: CardDefinition = {
	id: "pareto",
	needs: monthNeeds.pareto,
	visible: () => true,
	build: buildParetoCard,
};
