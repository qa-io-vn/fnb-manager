import type { AnalyticsRow } from "../../../contract/functions.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type { CardModel } from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import {
	type DriverCandidate,
	narrate,
	strongestDriver,
} from "../../../model/narrative.js";
import { exactDifference, relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { dayKeys } from "../keys.js";
import {
	dayCalls,
	dayCsvName,
	dayMarkers,
	dayNeeds,
	dayValue,
	ITEM_DRIVER_POOL,
	TOP_ITEM_COUNT,
} from "../support.js";

type ItemRow = AnalyticsRow<"item_summary">;

export function soldItems(input: CardInput): ItemRow[] {
	return (input.results.rows(dayCalls.items, "item_summary") ?? []).filter(
		(row) => row.quantity > 0,
	);
}

function itemDrivers(items: readonly ItemRow[]): DriverCandidate[] {
	return items.slice(0, ITEM_DRIVER_POOL).map((row) => ({
		dimension: "item" as const,
		label: textValue("text", row.item_name),
		contribution: exactDifference(row.net_amount, row.compare_net_amount ?? 0),
		unit: "money" as const,
	}));
}

function soldOnPreviousDay(all: readonly ItemRow[]): boolean {
	return all.some((row) => (row.compare_quantity ?? 0) > 0);
}

function moverClause(
	all: readonly ItemRow[],
	items: readonly ItemRow[],
): SentencePart | null {
	if (!soldOnPreviousDay(all)) return null;
	const strongest = strongestDriver(itemDrivers(items), 0);
	if (strongest === null) return null;
	return part(dayKeys.items.mover, {
		item: strongest.candidate.label,
		delta: numberValue("moneySigned", strongest.candidate.contribution),
	});
}

export function buildTopItemsCard(input: CardInput): CardModel {
	const { context } = input;
	const all = input.results.rows(dayCalls.items, "item_summary") ?? [];
	const items = soldItems(input);
	const top = items.slice(0, TOP_ITEM_COUNT);
	const leader = top[0] ?? null;
	const values: Record<string, TypedValue> = { day: dayValue(context) };
	if (leader !== null) {
		values.item = textValue("text", leader.item_name);
		values.quantity = numberValue("decimal", leader.quantity);
		if (leader.net_share !== null) {
			values.share = numberValue("percent", leader.net_share);
		}
	}
	const parts = narrate({
		main: {
			up: dayKeys.items.leader,
			down: dayKeys.items.leader,
			flat: dayKeys.items.leader,
			noReference: dayKeys.items.leader,
			noData: dayKeys.items.noData,
		},
		values,
		current: leader === null ? null : leader.net_amount,
		comparison: null,
		notes: [],
		drivers: [],
		decomposition: null,
	});
	const driver: SentencePart | null =
		leader === null ? null : moverClause(all, items);
	return {
		id: "top_items",
		titleKey: dayKeys.items.title,
		subtitle: null,
		metricId: "item_net",
		relatedMetricIds: [],
		headline: {
			value: leader === null ? null : leader.net_amount,
			unit: "money",
			caption:
				leader === null
					? null
					: part(dayKeys.items.caption, {
							item: textValue("text", leader.item_name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: driver === null ? parts : [...parts, driver].slice(0, 3),
		tables: [
			tableModel({
				captionKey: dayKeys.items.table,
				columns: [
					column("item", reportKeys.table.item, "text"),
					column("quantity", reportKeys.table.quantity, "decimal"),
					column("net", reportKeys.table.netAmount, "money"),
					column("share", reportKeys.table.share, "percent"),
					column("previous", dayKeys.table.previousDay, "money"),
					column("change", dayKeys.table.changePrevious, "signedPercent"),
				],
				rows: top.map((row) => ({
					id: row.item_external_id,
					cells: {
						item: row.item_name,
						quantity: row.quantity,
						net: row.net_amount,
						share: row.net_share,
						previous: row.compare_net_amount,
						change: relativeChange(row.net_amount, row.compare_net_amount),
					},
				})),
				initialSort: { key: "net", direction: "descending" },
			}),
		],
		chart:
			top.length === 0
				? null
				: {
						labelKey: dayKeys.items.chart,
						categories: top.map((row) => textValue("text", row.item_name)),
						series: [
							{
								label: part(reportKeys.periodRow.current),
								kind: "bar",
								tone: "primary",
								axis: "left",
								stack: null,
								values: top.map((row) => row.net_amount),
							},
							{
								label: part(reportKeys.periodRow.previous),
								kind: "bar",
								tone: "muted",
								axis: "left",
								stack: null,
								values: top.map((row) => row.compare_net_amount),
							},
						],
						leftUnit: "money",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice: null,
		markers: dayMarkers(input, true),
		csvName: dayCsvName(context, "top_items"),
	};
}

export const topItemsCard: CardDefinition = {
	id: "top_items",
	needs: dayNeeds.items,
	visible: () => true,
	build: buildTopItemsCard,
};
