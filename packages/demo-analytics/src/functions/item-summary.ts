import {
	type AnalyticsRow,
	addDays,
	type IsoDate,
	maxDate,
	minDate,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { ItemAggregate } from "../ingest.js";
import { isOnMenu } from "../menus.js";
import { money, quantity, roundedRatio } from "../pg-numeric.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireCompareRange,
	requireDateRange,
	requireReportRows,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"item_summary">;

export const ITEM_SUMMARY_MAX_DAYS = 400;

interface Labels {
	itemName: string | null;
	baseName: string | null;
	sizeLabel: string | null;
	typeId: string | null;
	typeName: string | null;
}

interface ItemTotals {
	current: Labels;
	compare: Labels;
	soldInCurrent: boolean;
	quantityMilli: number;
	netMinor: number;
	invoices: number;
	days: Set<IsoDate>;
	compareQuantityMilli: number;
	compareNetMinor: number;
	firstPosition: number;
}

function emptyLabels(): Labels {
	return {
		itemName: null,
		baseName: null,
		sizeLabel: null,
		typeId: null,
		typeName: null,
	};
}

function maxOf(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

function withLabels(labels: Labels, item: ItemAggregate): Labels {
	return {
		itemName: maxOf(labels.itemName, item.itemName),
		baseName: maxOf(labels.baseName, item.baseName),
		sizeLabel: maxOf(labels.sizeLabel, item.sizeLabel),
		typeId: maxOf(labels.typeId, item.itemTypeExternalId),
		typeName: maxOf(labels.typeName, item.itemTypeName),
	};
}

function inRange(
	date: IsoDate,
	from: IsoDate | undefined,
	to: IsoDate | undefined,
): boolean {
	return from !== undefined && to !== undefined && date >= from && date <= to;
}

export interface SoldDates {
	first: IsoDate;
	last: IsoDate;
}

export function soldDates(
	store: AggregateStore,
	storeIds: readonly string[],
	itemIds: readonly string[],
): Map<string, SoldDates> {
	const result = new Map<string, SoldDates>();
	const asOf = store.asOf();
	for (const visible of store.visibleStores(storeIds)) {
		const range = store.days.storeRange(visible);
		if (range === null) continue;
		const pendingFirst = new Set(itemIds);
		for (
			let date = range.from;
			date <= range.to && pendingFirst.size > 0;
			date = addDays(date, 1)
		) {
			if (
				![...pendingFirst].some((id) => isOnMenu(id, visible.id, date, asOf))
			) {
				continue;
			}
			const day = store.day(visible.id, date);
			if (day === null) continue;
			for (const item of day.items) {
				if (!pendingFirst.has(item.itemExternalId)) continue;
				pendingFirst.delete(item.itemExternalId);
				const known = result.get(item.itemExternalId);
				if (known === undefined) {
					result.set(item.itemExternalId, { first: date, last: date });
				} else if (date < known.first) {
					known.first = date;
				}
			}
		}
		const pendingLast = new Set(itemIds);
		for (
			let date = range.to;
			date >= range.from && pendingLast.size > 0;
			date = addDays(date, -1)
		) {
			if (
				![...pendingLast].some((id) => isOnMenu(id, visible.id, date, asOf))
			) {
				continue;
			}
			const day = store.day(visible.id, date);
			if (day === null) continue;
			for (const item of day.items) {
				if (!pendingLast.has(item.itemExternalId)) continue;
				pendingLast.delete(item.itemExternalId);
				const known = result.get(item.itemExternalId);
				if (known === undefined) {
					result.set(item.itemExternalId, { first: date, last: date });
				} else if (date > known.last) {
					known.last = date;
				}
			}
		}
	}
	return result;
}

export function itemSummary(
	store: AggregateStore,
	args: HandlerArgs<"item_summary">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("item_summary", args.store_ids);
	requireDateRange(
		"item_summary",
		args.from_date,
		args.to_date,
		ITEM_SUMMARY_MAX_DAYS,
	);
	requireCompareRange(
		"item_summary",
		args.compare_from,
		args.compare_to,
		ITEM_SUMMARY_MAX_DAYS,
	);
	const hasCompare = args.compare_from !== undefined;
	const totals = new Map<string, ItemTotals>();
	const visibleStores = store.visibleStores(args.store_ids);
	const mappings = store.mappings();
	const accounts = visibleStores.map((entry) => mappings.accountOf(entry.id));
	const collect = (from: IsoDate, to: IsoDate) => {
		visibleStores.forEach((visible, position) => {
			for (const day of store.daysOf(visible, from, to)) {
				const current = inRange(day.date, args.from_date, args.to_date);
				const compare = inRange(day.date, args.compare_from, args.compare_to);
				for (const item of day.items) {
					const known: ItemTotals = totals.get(item.itemExternalId) ?? {
						current: emptyLabels(),
						compare: emptyLabels(),
						soldInCurrent: false,
						quantityMilli: 0,
						netMinor: 0,
						invoices: 0,
						days: new Set(),
						compareQuantityMilli: 0,
						compareNetMinor: 0,
						firstPosition: position,
					};
					known.firstPosition = Math.min(known.firstPosition, position);
					if (current) {
						known.soldInCurrent = true;
						known.current = withLabels(known.current, item);
						known.quantityMilli += item.quantityMilli;
						known.netMinor += item.netMinor;
						known.invoices += item.invoices;
						known.days.add(day.date);
					}
					if (compare) {
						known.compare = withLabels(known.compare, item);
						known.compareQuantityMilli += item.quantityMilli;
						known.compareNetMinor += item.netMinor;
					}
					totals.set(item.itemExternalId, known);
				}
			}
		});
	};
	const ranges: [IsoDate, IsoDate][] = [[args.from_date, args.to_date]];
	if (args.compare_from !== undefined && args.compare_to !== undefined) {
		const overlap =
			args.compare_from <= args.to_date && args.compare_to >= args.from_date;
		if (overlap) {
			ranges[0] = [
				minDate(args.from_date, args.compare_from),
				maxDate(args.to_date, args.compare_to),
			];
		} else {
			ranges.push([args.compare_from, args.compare_to]);
		}
	}
	for (const [from, to] of ranges) collect(from, to);

	let currentTotal = 0;
	let compareTotal = 0;
	for (const item of totals.values()) {
		currentTotal += item.netMinor;
		compareTotal += item.compareNetMinor;
	}
	const sold = soldDates(store, args.store_ids, [...totals.keys()]);
	const rows: Row[] = [...totals.entries()]
		.map(([key, item]) => {
			const labels = item.soldInCurrent ? item.current : item.compare;
			const dates = sold.get(key);
			const override = mappings.overrideOf(
				accounts[item.firstPosition] as string,
				key,
			);
			const typeId = override?.itemTypeExternalId ?? labels.typeId;
			let role: Row["role"] = null;
			for (const account of accounts) {
				role = mappings.roleOf(account, typeId);
				if (role !== null) break;
			}
			return {
				item_external_id: key,
				item_name: labels.itemName ?? key,
				base_name: labels.baseName,
				size_label: labels.sizeLabel,
				item_type_external_id: typeId,
				item_type_name:
					override !== null ? override.itemTypeName : labels.typeName,
				role,
				quantity: quantity(item.quantityMilli).toNumber(),
				net_amount: money(item.netMinor).toNumber(),
				invoices: item.invoices,
				days_sold: item.days.size,
				net_share: roundedRatio(money(item.netMinor), money(currentTotal), 6),
				compare_quantity: hasCompare
					? quantity(item.compareQuantityMilli).toNumber()
					: null,
				compare_net_amount: hasCompare
					? money(item.compareNetMinor).toNumber()
					: null,
				compare_net_share: hasCompare
					? roundedRatio(money(item.compareNetMinor), money(compareTotal), 6)
					: null,
				first_sold_on: dates?.first ?? null,
				last_sold_on: dates?.last ?? null,
				sortNet: item.netMinor,
				sortQuantity: item.quantityMilli,
			};
		})
		.sort(
			(left, right) =>
				right.sortNet - left.sortNet ||
				right.sortQuantity - left.sortQuantity ||
				(left.item_external_id < right.item_external_id
					? -1
					: left.item_external_id > right.item_external_id
						? 1
						: 0),
		)
		.map(({ sortNet: _net, sortQuantity: _quantity, ...row }) => row);
	requireReportRows("item_summary", rows.length);
	return rows;
}
