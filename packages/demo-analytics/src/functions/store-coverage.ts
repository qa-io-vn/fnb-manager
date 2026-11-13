import {
	type AnalyticsRow,
	addDays,
	datesBetween,
	type IsoDate,
	maxDate,
	storeBusinessDate,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoStoreDefinition } from "../calendar.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireDateRange,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"store_coverage">;

export const STORE_COVERAGE_MAX_DAYS = 400;

function hasSales(
	store: AggregateStore,
	visible: DemoStoreDefinition,
	date: IsoDate,
): boolean {
	return (store.day(visible.id, date)?.daily?.invoices ?? 0) > 0;
}

export function firstSalesOn(
	store: AggregateStore,
	visible: DemoStoreDefinition,
): IsoDate | null {
	const range = store.days.storeRange(visible);
	if (range === null) return null;
	for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
		if (hasSales(store, visible, date)) return date;
	}
	return null;
}

export function lastSalesOn(
	store: AggregateStore,
	visible: DemoStoreDefinition,
): IsoDate | null {
	const range = store.days.storeRange(visible);
	if (range === null) return null;
	for (let date = range.to; date >= range.from; date = addDays(date, -1)) {
		if (hasSales(store, visible, date)) return date;
	}
	return null;
}

export function historyStart(
	openedOn: IsoDate | null,
	firstSales: IsoDate | null,
): IsoDate | null {
	if (openedOn === null) return firstSales;
	if (firstSales === null) return openedOn;
	return maxDate(openedOn, firstSales);
}

export function storeCoverage(
	store: AggregateStore,
	args: HandlerArgs<"store_coverage">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("store_coverage", args.store_ids);
	requireDateRange(
		"store_coverage",
		args.from_date,
		args.to_date,
		STORE_COVERAGE_MAX_DAYS,
	);
	return store.visibleStores(args.store_ids).map((visible) => {
		const first = firstSalesOn(store, visible);
		const dates = datesBetween(args.from_date, args.to_date);
		let salesDays = 0;
		let checkedDays = 0;
		let matchedDays = 0;
		let uncheckedSalesDays = 0;
		for (const date of dates) {
			const check = store.days.syncCheck(visible, date);
			if (check !== null) {
				checkedDays += 1;
				if (check.matched) matchedDays += 1;
			}
			if (hasSales(store, visible, date)) {
				salesDays += 1;
				if (check === null) uncheckedSalesDays += 1;
			}
		}
		return {
			store_id: visible.id,
			opened_on: visible.openedOn,
			first_sales_on: first,
			last_sales_on: lastSalesOn(store, visible),
			history_start: historyStart(visible.openedOn, first),
			store_as_of_date: addDays(storeBusinessDate(visible, context.now), -1),
			sales_days: salesDays,
			checked_days: checkedDays,
			matched_days: matchedDays,
			unmatched_days: checkedDays - matchedDays,
			unchecked_sales_days: uncheckedSalesDays,
			stale_days: 0,
			last_refreshed_at: null,
		};
	});
}
