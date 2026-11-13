import {
	type AnalyticsRow,
	addDays,
	firstOfYear,
	type IsoDate,
	periodBounds,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { demoRoleOf } from "../calendar.js";
import type { ItemAggregate } from "../ingest.js";
import { money, quantity } from "../pg-numeric.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireReportRows,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"item_lifecycle">;

const EARLIEST_DATE = "0001-01-01";
const RECENT_WINDOW_DAYS = 28;

interface DateWindow {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export interface LifecycleWindows {
	readonly recent: DateWindow;
	readonly prior: DateWindow;
	readonly yearToDate: DateWindow;
	readonly lastYearToDate: DateWindow;
}

export function lifecycleWindows(asOf: IsoDate): LifecycleWindows {
	const lastYear = periodBounds("year", asOf).find(
		(bound) => bound.period === "last_year",
	);
	if (lastYear === undefined) {
		throw new RangeError(`no last-year bound for ${asOf}`);
	}
	return {
		recent: { from: addDays(asOf, 1 - RECENT_WINDOW_DAYS), to: asOf },
		prior: {
			from: addDays(asOf, 1 - 2 * RECENT_WINDOW_DAYS),
			to: addDays(asOf, -RECENT_WINDOW_DAYS),
		},
		yearToDate: { from: firstOfYear(asOf), to: asOf },
		lastYearToDate: { from: lastYear.from, to: lastYear.to },
	};
}

class WindowSum {
	private present = false;
	private total = 0;

	add(value: number): void {
		this.present = true;
		this.total += value;
	}

	valueOr(scale: (units: number) => number): number | null {
		return this.present ? scale(this.total) : null;
	}

	units(): number | null {
		return this.present ? this.total : null;
	}
}

interface ItemHistory {
	itemName: string | null;
	typeId: string | null;
	typeName: string | null;
	first: IsoDate;
	last: IsoDate;
	readonly months: Set<string>;
	readonly recentQuantity: WindowSum;
	readonly priorQuantity: WindowSum;
	readonly yearQuantity: WindowSum;
	readonly lastYearQuantity: WindowSum;
	readonly yearNet: WindowSum;
	readonly lastYearNet: WindowSum;
	lifetimeQuantityMilli: number;
	lifetimeNetMinor: number;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

function within(date: IsoDate, window: DateWindow): boolean {
	return date >= window.from && date <= window.to;
}

function quantityOf(milli: number): number {
	return quantity(milli).toNumber();
}

function moneyOf(minor: number): number {
	return money(minor).toNumber();
}

function recordSale(
	history: ItemHistory,
	date: IsoDate,
	item: ItemAggregate,
	windows: LifecycleWindows,
): void {
	history.itemName = maxText(history.itemName, item.itemName);
	history.typeId = maxText(history.typeId, item.itemTypeExternalId);
	history.typeName = maxText(history.typeName, item.itemTypeName);
	if (date < history.first) history.first = date;
	if (date > history.last) history.last = date;
	history.months.add(date.slice(0, 7));
	if (within(date, windows.recent))
		history.recentQuantity.add(item.quantityMilli);
	if (within(date, windows.prior))
		history.priorQuantity.add(item.quantityMilli);
	if (within(date, windows.yearToDate)) {
		history.yearQuantity.add(item.quantityMilli);
		history.yearNet.add(item.netMinor);
	}
	if (within(date, windows.lastYearToDate)) {
		history.lastYearQuantity.add(item.quantityMilli);
		history.lastYearNet.add(item.netMinor);
	}
	history.lifetimeQuantityMilli += item.quantityMilli;
	history.lifetimeNetMinor += item.netMinor;
}

function newHistory(date: IsoDate): ItemHistory {
	return {
		itemName: null,
		typeId: null,
		typeName: null,
		first: date,
		last: date,
		months: new Set(),
		recentQuantity: new WindowSum(),
		priorQuantity: new WindowSum(),
		yearQuantity: new WindowSum(),
		lastYearQuantity: new WindowSum(),
		yearNet: new WindowSum(),
		lastYearNet: new WindowSum(),
		lifetimeQuantityMilli: 0,
		lifetimeNetMinor: 0,
	};
}

function byYearNetThenKey(
	left: { key: string; yearNetMinor: number | null },
	right: { key: string; yearNetMinor: number | null },
): number {
	if (left.yearNetMinor !== right.yearNetMinor) {
		if (left.yearNetMinor === null) return 1;
		if (right.yearNetMinor === null) return -1;
		return right.yearNetMinor - left.yearNetMinor;
	}
	return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

export function itemLifecycle(
	store: AggregateStore,
	args: HandlerArgs<"item_lifecycle">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("item_lifecycle", args.store_ids);
	const asOf = args.as_of_date;
	const windows = lifecycleWindows(asOf);
	const items = new Map<string, ItemHistory>();
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(visible, EARLIEST_DATE, asOf)) {
			for (const item of day.items) {
				let history = items.get(item.itemExternalId);
				if (history === undefined) {
					history = newHistory(day.date);
					items.set(item.itemExternalId, history);
				}
				recordSale(history, day.date, item, windows);
			}
		}
	}
	const rows = [...items.entries()]
		.map(([key, history]) => ({
			key,
			yearNetMinor: history.yearNet.units(),
			row: {
				item_external_id: key,
				item_name: history.itemName ?? key,
				item_type_external_id: history.typeId,
				item_type_name: history.typeName,
				role: demoRoleOf(history.typeId),
				first_sold_on: history.first,
				last_sold_on: history.last,
				months_sold: history.months.size,
				quantity_28d: history.recentQuantity.valueOr(quantityOf),
				quantity_prior_28d: history.priorQuantity.valueOr(quantityOf),
				quantity_ytd: history.yearQuantity.valueOr(quantityOf),
				quantity_last_ytd: history.lastYearQuantity.valueOr(quantityOf),
				net_ytd: history.yearNet.valueOr(moneyOf),
				net_last_ytd: history.lastYearNet.valueOr(moneyOf),
				quantity_lifetime: quantityOf(history.lifetimeQuantityMilli),
				net_lifetime: moneyOf(history.lifetimeNetMinor),
			} satisfies Row,
		}))
		.sort(byYearNetThenKey)
		.map((entry) => entry.row);
	requireReportRows("item_lifecycle", rows.length);
	return rows;
}
