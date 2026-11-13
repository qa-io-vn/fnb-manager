import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { relativeChange } from "../../../model/numeric.js";
import { column, tableModel } from "../../../model/tables.js";
import { youngStoreNote } from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	textValue,
} from "../../../model/values.js";
import { yearKeys } from "../keys.js";
import {
	LIFECYCLE_STATUSES,
	type LifecycleRow,
	type LifecycleStatus,
	lifecycleStatus,
	type YearBounds,
	YOUNG_LIFECYCLE_STATUSES,
} from "../rules.js";
import {
	boundsOf,
	lifecycleRows,
	yearCsvName,
	yearMarkers,
	yearNeeds,
	yearValue,
} from "../support.js";

export interface ClassifiedItem {
	readonly row: LifecycleRow;
	readonly status: LifecycleStatus;
}

export interface LifecycleView {
	readonly basis: "all_stores" | "like_for_like" | "none";
	readonly items: readonly ClassifiedItem[];
	readonly statuses: readonly LifecycleStatus[];
	readonly coveredStores: number;
	readonly totalStores: number;
}

export function lifecycleView(input: CardInput): LifecycleView {
	const bounds = boundsOf(input.context);
	const reference = input.coverage.forReference(bounds.lastYearStart);
	const basis =
		reference.state === "full"
			? "all_stores"
			: reference.state === "partial"
				? "like_for_like"
				: "none";
	const limited = basis === "none";
	const items = lifecycleRows(input, basis === "like_for_like").flatMap(
		(row) => {
			const status = lifecycleStatus(row, bounds, limited);
			return status === null ? [] : [{ row, status }];
		},
	);
	return {
		basis,
		items,
		statuses: limited ? YOUNG_LIFECYCLE_STATUSES : LIFECYCLE_STATUSES,
		coveredStores: reference.coveredStoreIds.length,
		totalStores: reference.storeCount,
	};
}

function byNetThenName(left: ClassifiedItem, right: ClassifiedItem): number {
	const leftNet = left.row.net_ytd ?? Number.NEGATIVE_INFINITY;
	const rightNet = right.row.net_ytd ?? Number.NEGATIVE_INFINITY;
	if (leftNet !== rightNet) return rightNet - leftNet;
	return left.row.item_name < right.row.item_name
		? -1
		: left.row.item_name > right.row.item_name
			? 1
			: 0;
}

function byLifetimeNet(left: ClassifiedItem, right: ClassifiedItem): number {
	return (right.row.net_lifetime ?? 0) - (left.row.net_lifetime ?? 0);
}

export function countsOf(
	view: LifecycleView,
): Readonly<Record<LifecycleStatus, number>> {
	const counts: Record<LifecycleStatus, number> = {
		new: 0,
		growing: 0,
		declining: 0,
		discontinued: 0,
		steady: 0,
	};
	for (const item of view.items) counts[item.status] += 1;
	return counts;
}

function ofStatus(
	view: LifecycleView,
	status: LifecycleStatus,
): ClassifiedItem[] {
	return view.items.filter((item) => item.status === status);
}

function countSentence(view: LifecycleView, bounds: YearBounds): SentencePart {
	if (view.items.length === 0) {
		return part(yearKeys.lifecycle.noData, { year: yearValue(bounds) });
	}
	const counts = countsOf(view);
	const count = (status: LifecycleStatus) =>
		numberValue("count", counts[status]);
	if (view.basis === "none") {
		return part(yearKeys.lifecycle.mainYoung, {
			year: yearValue(bounds),
			new: count("new"),
			discontinued: count("discontinued"),
		});
	}
	return part(yearKeys.lifecycle.main, {
		year: yearValue(bounds),
		new: count("new"),
		growing: count("growing"),
		declining: count("declining"),
		discontinued: count("discontinued"),
		steady: count("steady"),
	});
}

function lifecycleTable(view: LifecycleView): TableModel {
	const order = new Map(view.statuses.map((status, index) => [status, index]));
	const rows = [...view.items].sort(
		(left, right) =>
			(order.get(left.status) ?? 0) - (order.get(right.status) ?? 0) ||
			byNetThenName(left, right),
	);
	return tableModel({
		captionKey:
			view.basis === "like_for_like"
				? yearKeys.lifecycle.tableLikeForLike
				: yearKeys.lifecycle.table,
		columns: [
			column("item", reportKeys.table.item, "text"),
			column("stage", yearKeys.table.stage, "message"),
			column("firstSold", yearKeys.table.firstSold, "date"),
			column("lastSold", yearKeys.table.lastSold, "date"),
			column("quantityYtd", yearKeys.table.quantityYtd, "decimal"),
			column("quantityLastYtd", yearKeys.table.quantityLastYtd, "decimal"),
			column("change", reportKeys.table.change, "signedPercent"),
			column("netYtd", yearKeys.table.netYtd, "money"),
		],
		rows: rows.map(({ row, status }) => ({
			id: row.item_external_id,
			cells: {
				item: row.item_name,
				stage: yearKeys.lifecycle.status[status],
				firstSold: row.first_sold_on,
				lastSold: row.last_sold_on,
				quantityYtd: row.quantity_ytd,
				quantityLastYtd: row.quantity_last_ytd,
				change: relativeChange(row.quantity_ytd, row.quantity_last_ytd),
				netYtd: row.net_ytd,
			},
		})),
	});
}

function lifecycleChart(view: LifecycleView): ChartModel | null {
	if (view.items.length === 0) return null;
	const counts = countsOf(view);
	return {
		labelKey: yearKeys.lifecycle.chart,
		categories: view.statuses.map((status) =>
			messageValue(yearKeys.lifecycle.status[status]),
		),
		series: [
			{
				label: part(yearKeys.lifecycle.chartSeries),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: view.statuses.map((status) => counts[status]),
			},
		],
		leftUnit: "count",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

function youngNotice(input: CardInput, bounds: YearBounds): NoticeModel | null {
	const young = youngStoreNote(
		input.context,
		input.coverage,
		bounds.lastYearStart,
	);
	if (young === null) return null;
	return {
		tone: "info",
		part: part(yearKeys.lifecycle.tooYoung, young.values),
		action: null,
	};
}

export function buildItemLifecycleCard(input: CardInput): CardModel {
	const { context } = input;
	const bounds = boundsOf(context);
	const view = lifecycleView(input);
	const newItems = ofStatus(view, "new").sort(byNetThenName);
	const discontinued = ofStatus(view, "discontinued").sort(byLifetimeNet);
	const topNew = newItems[0] ?? null;
	const topDiscontinued = discontinued[0] ?? null;
	const narrative: SentencePart[] = [countSentence(view, bounds)];
	if (topNew !== null) {
		narrative.push(
			part(yearKeys.lifecycle.topNew, {
				item: textValue("text", topNew.row.item_name),
				value: numberValue("money", topNew.row.net_ytd ?? 0),
			}),
		);
	}
	if (topDiscontinued?.row.last_sold_on) {
		narrative.push(
			part(yearKeys.lifecycle.topDiscontinued, {
				item: textValue("text", topDiscontinued.row.item_name),
				date: textValue("date", topDiscontinued.row.last_sold_on),
			}),
		);
	}
	return {
		id: "item_lifecycle",
		titleKey: yearKeys.lifecycle.title,
		subtitle:
			view.basis === "like_for_like"
				? part(reportKeys.clause.coverage.likeForLike, {
						covered: numberValue("count", view.coveredStores),
						total: numberValue("count", view.totalStores),
					})
				: null,
		metricId: "item_lifecycle_count",
		relatedMetricIds: ["item_velocity"],
		headline: {
			value: view.items.length === 0 ? null : newItems.length,
			unit: "count",
			caption:
				topNew === null
					? null
					: part(yearKeys.lifecycle.caption, {
							item: textValue("text", topNew.row.item_name),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrative.slice(0, 3),
		tables: [lifecycleTable(view)],
		chart: lifecycleChart(view),
		notice:
			view.items.length === 0
				? {
						tone: "info",
						part: part(yearKeys.noSales, { year: yearValue(bounds) }),
						action: null,
					}
				: view.basis === "none"
					? youngNotice(input, bounds)
					: null,
		markers: yearMarkers(input, true),
		csvName: yearCsvName(context, "item_lifecycle"),
	};
}

export const itemLifecycleCard: CardDefinition = {
	id: "item_lifecycle",
	needs: yearNeeds.lifecycle,
	visible: () => true,
	build: buildItemLifecycleCard,
};
