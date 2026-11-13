import type { HolidayEntry } from "@fnb/core";
import {
	AnalyticsCallError,
	type AnalyticsFunctionName,
	type AnalyticsRow,
	type analyticsFunctions,
	daysBetween,
	type IsoDate,
	MAX_STORE_IDS,
} from "@fnb/reports";
import type { z } from "zod";
import type { AggregateStore } from "../aggregates.js";
import type { DemoStoreDefinition } from "../calendar.js";
import { isExcludedDemoDay } from "../excluded.js";
import type { DailyAggregate, HourlyAggregate } from "../ingest.js";
import {
	count,
	decimal,
	money,
	PgDecimal,
	quantity,
	roundedRatio,
} from "../pg-numeric.js";

export const INVALID_PARAMETER_VALUE = "22023";
export const MAX_REPORT_ROWS = 900;

export interface HandlerContext {
	readonly now: Date;
	readonly holidays: readonly HolidayEntry[];
}

export type HandlerArgs<N extends AnalyticsFunctionName> = z.output<
	(typeof analyticsFunctions)[N]["args"]
>;

export type Handler<N extends AnalyticsFunctionName> = (
	store: AggregateStore,
	args: HandlerArgs<N>,
	context: HandlerContext,
) => AnalyticsRow<N>[];

export function invalid(name: AnalyticsFunctionName, message: string): never {
	throw new AnalyticsCallError(name, INVALID_PARAMETER_VALUE, message);
}

export function requireStoreIds(
	name: AnalyticsFunctionName,
	storeIds: readonly string[],
): void {
	if (storeIds.length > MAX_STORE_IDS) {
		invalid(
			name,
			`${name} needs store_ids with 0 to ${MAX_STORE_IDS} store ids`,
		);
	}
}

export function requireDateRange(
	name: AnalyticsFunctionName,
	from: IsoDate,
	to: IsoDate,
	maxDays: number,
): void {
	if (from > to) {
		invalid(
			name,
			`${name} needs a date range whose start is not after its end`,
		);
	}
	const days = daysBetween(from, to) + 1;
	if (days > maxDays) {
		invalid(name, `${name} covers at most ${maxDays} days, not ${days}`);
	}
}

export function requireCompareRange(
	name: AnalyticsFunctionName,
	from: IsoDate | undefined,
	to: IsoDate | undefined,
	maxDays: number,
): void {
	if (from === undefined && to === undefined) return;
	if (from === undefined || to === undefined) {
		invalid(name, `${name} needs compare_from and compare_to together`);
	}
	requireDateRange(name, from, to, maxDays);
}

export function requireReportRows(
	name: AnalyticsFunctionName,
	rows: number,
): void {
	if (rows > MAX_REPORT_ROWS) {
		invalid(
			name,
			`${name} returns at most ${MAX_REPORT_ROWS} rows, this call needs ${rows}`,
		);
	}
}

export interface DailySalesRow {
	readonly store: DemoStoreDefinition;
	readonly date: IsoDate;
	readonly daily: DailyAggregate;
}

export function dailySales(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): DailySalesRow[] {
	const rows: DailySalesRow[] = [];
	if (from > to) return rows;
	for (const visible of store.visibleStores(storeIds)) {
		for (const day of store.daysOf(visible, from, to)) {
			if (day.daily !== null) {
				rows.push({ store: visible, date: day.date, daily: day.daily });
			}
		}
	}
	return rows;
}

export interface HourlySalesRow {
	readonly store: DemoStoreDefinition;
	readonly date: IsoDate;
	readonly hourly: HourlyAggregate;
}

export function hourlySales(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): HourlySalesRow[] {
	const rows: HourlySalesRow[] = [];
	if (from > to) return rows;
	for (const visible of store.visibleStores(storeIds)) {
		for (const day of store.daysOf(visible, from, to)) {
			for (const hourly of day.hourly) {
				rows.push({ store: visible, date: day.date, hourly });
			}
		}
	}
	return rows;
}

export function isExcludedFor(
	store: AggregateStore,
	storeIds: readonly string[],
	date: IsoDate,
	holidays: readonly HolidayEntry[],
): boolean {
	return (
		store.visibleStores(storeIds).length > 0 &&
		isExcludedDemoDay(holidays, date)
	);
}

export interface DailySums {
	readonly days: number;
	readonly invoices: number;
	readonly grossMinor: number;
	readonly itemDiscountMinor: number;
	readonly billDiscountMinor: number;
	readonly voucherMinor: number;
	readonly netMinor: number;
	readonly paidMinor: number;
	readonly cashMinor: number;
	readonly itemsMilli: number;
	readonly voucherInvoices: number;
	readonly memberInvoices: number;
	readonly identifiedInvoices: number;
	readonly voidedInvoices: number;
	readonly voidedMinor: number;
	readonly editedInvoices: number;
	readonly modifierLines: number;
}

export function sumDaily(
	rows: readonly { daily: DailyAggregate }[],
): DailySums {
	const sums = {
		days: 0,
		invoices: 0,
		grossMinor: 0,
		itemDiscountMinor: 0,
		billDiscountMinor: 0,
		voucherMinor: 0,
		netMinor: 0,
		paidMinor: 0,
		cashMinor: 0,
		itemsMilli: 0,
		voucherInvoices: 0,
		memberInvoices: 0,
		identifiedInvoices: 0,
		voidedInvoices: 0,
		voidedMinor: 0,
		editedInvoices: 0,
		modifierLines: 0,
	};
	for (const { daily } of rows) {
		sums.days += 1;
		sums.invoices += daily.invoices;
		sums.grossMinor += daily.grossMinor;
		sums.itemDiscountMinor += daily.itemDiscountMinor;
		sums.billDiscountMinor += daily.billDiscountMinor;
		sums.voucherMinor += daily.voucherMinor;
		sums.netMinor += daily.netMinor;
		sums.paidMinor += daily.paidMinor;
		sums.cashMinor += daily.cashMinor;
		sums.itemsMilli += daily.itemsMilli;
		sums.voucherInvoices += daily.voucherInvoices;
		sums.memberInvoices += daily.memberInvoices;
		sums.identifiedInvoices += daily.identifiedInvoices;
		sums.voidedInvoices += daily.voidedInvoices;
		sums.voidedMinor += daily.voidedMinor;
		sums.editedInvoices += daily.editedInvoices;
		sums.modifierLines += daily.modifierLines;
	}
	return sums;
}

export interface PeriodTotals {
	readonly days_with_data: number;
	readonly invoices: number | null;
	readonly net_amount: number | null;
	readonly gross_amount: number | null;
	readonly item_discount_amount: number | null;
	readonly bill_discount_amount: number | null;
	readonly voucher_amount: number | null;
	readonly discount_amount: number | null;
	readonly paid_amount: number | null;
	readonly cash_amount: number | null;
	readonly items_sold: number | null;
	readonly voucher_invoices: number | null;
	readonly member_invoices: number | null;
	readonly identified_invoices: number | null;
	readonly voided_invoices: number | null;
	readonly voided_amount: number | null;
	readonly edited_invoices: number | null;
	readonly avg_ticket: number | null;
	readonly items_per_ticket: number | null;
	readonly avg_item_price: number | null;
	readonly cash_share: number | null;
	readonly voucher_share: number | null;
	readonly member_share: number | null;
	readonly identified_share: number | null;
	readonly discount_rate: number | null;
}

export const EMPTY_TOTALS: PeriodTotals = {
	days_with_data: 0,
	invoices: null,
	net_amount: null,
	gross_amount: null,
	item_discount_amount: null,
	bill_discount_amount: null,
	voucher_amount: null,
	discount_amount: null,
	paid_amount: null,
	cash_amount: null,
	items_sold: null,
	voucher_invoices: null,
	member_invoices: null,
	identified_invoices: null,
	voided_invoices: null,
	voided_amount: null,
	edited_invoices: null,
	avg_ticket: null,
	items_per_ticket: null,
	avg_item_price: null,
	cash_share: null,
	voucher_share: null,
	member_share: null,
	identified_share: null,
	discount_rate: null,
};

export function totalsOf(sums: DailySums): PeriodTotals {
	if (sums.days === 0) return EMPTY_TOTALS;
	const invoices = count(sums.invoices);
	const net = money(sums.netMinor);
	const items = quantity(sums.itemsMilli);
	const discountMinor =
		sums.itemDiscountMinor + sums.billDiscountMinor + sums.voucherMinor;
	return {
		days_with_data: sums.days,
		invoices: sums.invoices,
		net_amount: decimal(net),
		gross_amount: decimal(money(sums.grossMinor)),
		item_discount_amount: decimal(money(sums.itemDiscountMinor)),
		bill_discount_amount: decimal(money(sums.billDiscountMinor)),
		voucher_amount: decimal(money(sums.voucherMinor)),
		discount_amount: decimal(money(discountMinor)),
		paid_amount: decimal(money(sums.paidMinor)),
		cash_amount: decimal(money(sums.cashMinor)),
		items_sold: decimal(items),
		voucher_invoices: sums.voucherInvoices,
		member_invoices: sums.memberInvoices,
		identified_invoices: sums.identifiedInvoices,
		voided_invoices: sums.voidedInvoices,
		voided_amount: decimal(money(sums.voidedMinor)),
		edited_invoices: sums.editedInvoices,
		avg_ticket: roundedRatio(net, invoices, 2),
		items_per_ticket: roundedRatio(items, invoices, 4),
		avg_item_price: roundedRatio(net, items, 2),
		cash_share: roundedRatio(money(sums.cashMinor), money(sums.paidMinor), 6),
		voucher_share: roundedRatio(count(sums.voucherInvoices), invoices, 6),
		member_share: roundedRatio(count(sums.memberInvoices), invoices, 6),
		identified_share: roundedRatio(count(sums.identifiedInvoices), invoices, 6),
		discount_rate: roundedRatio(
			money(discountMinor),
			money(sums.grossMinor),
			6,
		),
	};
}

export function periodTotals(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): PeriodTotals {
	return totalsOf(sumDaily(dailySales(store, storeIds, from, to)));
}

export function moneyValue(minor: number): number {
	return money(minor).toNumber();
}

export function quantityValue(milli: number): number {
	return quantity(milli).toNumber();
}

export function zeroDecimal(): PgDecimal {
	return PgDecimal.zero(0);
}
