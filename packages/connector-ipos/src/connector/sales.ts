import {
	businessDate,
	type CanonicalSale,
	type CanonicalStore,
	type Channel,
	type DataQualityFlag,
	instantOnBusinessDate,
	roundMoney,
	shiftIsoDate,
	sumMoney,
	wallClockIn,
} from "@fnb/core";
import type { Invoice, InvoiceLine, Payment } from "../schemas/accounting.js";
import { FLAG_CODES, flag, flagsForSale } from "./flags.js";
import { mapInvoiceLines } from "./lines.js";
import type { MasterIndex } from "./master-index.js";
import { normaliseName, type ResolvedIposOptions } from "./options.js";
import { mapPayment, paymentFromInvoiceHeader } from "./payments.js";

export interface AccountingRows {
	invoices: readonly Invoice[];
	lines: readonly InvoiceLine[];
	payments: readonly Payment[];
}

export interface BuiltSales {
	sales: CanonicalSale[];
	flags: DataQualityFlag[];
}

function groupByTranId<T extends { tran_id: string }>(
	rows: readonly T[],
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const group = groups.get(row.tran_id);
		if (group) {
			group.push(row);
		} else {
			groups.set(row.tran_id, [row]);
		}
	}
	return groups;
}

export function resolveChannel(
	invoice: Pick<Invoice, "sale_type" | "source_id" | "source_name">,
	options: ResolvedIposOptions,
): Channel {
	const sourceKeys = [invoice.source_id, invoice.source_name]
		.filter((value): value is string => Boolean(value))
		.map(normaliseName);
	if (sourceKeys.some((key) => options.deliverySources.has(key))) {
		return "delivery";
	}
	const saleType = invoice.sale_type?.trim().toUpperCase() ?? "";
	return options.saleTypeChannels[saleType] ?? "other";
}

function wallClockInstant(
	date: string,
	hour: number | null | undefined,
	minute: number | null | undefined,
	store: CanonicalStore,
): Date | undefined {
	if (hour === null || hour === undefined) {
		return undefined;
	}
	return instantOnBusinessDate(
		date,
		hour * 60 + (minute ?? 0),
		store.timezone,
		store.dayStartMinutes,
	);
}

function openedBefore(
	openedAt: Date | undefined,
	reference: Date,
	date: string,
	store: CanonicalStore,
): Date | undefined {
	if (!openedAt || openedAt.getTime() <= reference.getTime()) {
		return openedAt;
	}
	const clock = wallClockIn(openedAt, store.timezone);
	return instantOnBusinessDate(
		shiftIsoDate(date, -1),
		clock.hour * 60 + clock.minute,
		store.timezone,
		store.dayStartMinutes,
	);
}

function text(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function toSale(
	invoice: Invoice,
	lineRows: readonly InvoiceLine[],
	paymentRows: readonly Payment[],
	store: CanonicalStore,
	index: MasterIndex,
	options: ResolvedIposOptions,
): { sale: CanonicalSale; flags: DataQualityFlag[] } {
	const flags: DataQualityFlag[] = [];
	const soldAt = new Date(invoice.tran_date);
	const date = businessDate(soldAt, store.timezone, store.dayStartMinutes);
	const mapped = mapInvoiceLines(lineRows, index, options);
	let payments = paymentRows.map((row) => mapPayment(row, options));
	if (payments.length === 0) {
		const fallback = paymentFromInvoiceHeader(invoice, options);
		payments = fallback ? [fallback] : [];
		flags.push(
			flag(
				FLAG_CODES.paymentsMissing,
				"no payment rows were returned for this invoice; the header payment method was used",
				"warn",
				invoice.tran_id,
			),
		);
	}
	const itemDiscountAmount = roundMoney(
		(invoice.amount_discount_detail ?? 0) +
			(invoice.amount_discount_price ?? 0),
	);
	const billDiscountAmount = invoice.discount_extra_amount ?? 0;
	const voucherAmount = invoice.voucher_amount_paid ?? 0;
	const closedAt = wallClockInstant(
		date,
		invoice.end_hour,
		invoice.end_minute,
		store,
	);
	const openedAt = openedBefore(
		wallClockInstant(date, invoice.start_hour, invoice.start_minute, store),
		closedAt ?? soldAt,
		date,
		store,
	);
	const sale: CanonicalSale = {
		externalId: invoice.tran_id,
		receiptNo: text(invoice.tran_no),
		soldAt,
		businessDate: date,
		...(openedAt ? { openedAt } : {}),
		...(closedAt ? { closedAt } : {}),
		channel: resolveChannel(invoice, options),
		sourceExternalId: text(invoice.source_id),
		sourceName: text(invoice.source_name),
		tableName: text(invoice.table_name),
		areaName: text(invoice.area_name),
		shiftExternalId: text(invoice.shift_id),
		employeeExternalId: text(invoice.employee_id),
		employeeName: text(invoice.employee_name),
		guestCount: Math.max(0, Math.trunc(invoice.peo_count ?? 0)),
		customerPhone: text(invoice.customer_phone),
		customerName: text(invoice.customer_name),
		grossAmount: roundMoney(invoice.amount_origin + itemDiscountAmount),
		itemDiscountAmount,
		billDiscountAmount,
		billDiscountName: text(invoice.discount_extra_name),
		voucherCode: text(invoice.voucher_code),
		voucherName: text(invoice.voucher_name),
		voucherAmount,
		partnerMarketingAmount: invoice.partner_marketing_amount ?? 0,
		serviceChargeAmount: invoice.service_charge_amount ?? 0,
		shippingFeeAmount: invoice.ship_fee_amount ?? 0,
		vatAmount: invoice.vat_amount ?? 0,
		netAmount: invoice.total_amount,
		paidAmount: sumMoney(payments.map((payment) => payment.amount)),
		status: "completed",
		lines: mapped.lines,
		payments,
		raw: invoice,
	};
	if (lineRows.length === 0) {
		flags.push(
			flag(
				FLAG_CODES.missingLines,
				"no sale-detail rows were returned for this invoice",
				"warn",
				invoice.tran_id,
			),
		);
	}
	for (const itemId of new Set(mapped.unknownItemIds)) {
		flags.push(
			flag(
				FLAG_CODES.unknownItem,
				`line item ${itemId} is not in the store's item master`,
				"info",
				invoice.tran_id,
			),
		);
	}
	for (const itemName of new Set(mapped.untypedItemNames)) {
		flags.push(
			flag(
				FLAG_CODES.unknownItemType,
				`item "${itemName}" has no resolvable item type`,
				"info",
				invoice.tran_id,
			),
		);
	}
	flags.push(...flagsForSale(sale, options.moneyTolerance));
	return { sale, flags };
}

export function buildSales(
	rows: AccountingRows,
	store: CanonicalStore,
	index: MasterIndex,
	options: ResolvedIposOptions,
): BuiltSales {
	const flags: DataQualityFlag[] = [];
	const linesByTran = groupByTranId(rows.lines);
	const paymentsByTran = groupByTranId(rows.payments);
	const seen = new Set<string>();
	const sales: CanonicalSale[] = [];
	for (const invoice of rows.invoices) {
		if (seen.has(invoice.tran_id)) {
			flags.push(
				flag(
					FLAG_CODES.duplicateSale,
					"the sale report returned this tran_id more than once; later rows were dropped",
					"warn",
					invoice.tran_id,
				),
			);
			continue;
		}
		seen.add(invoice.tran_id);
		const built = toSale(
			invoice,
			linesByTran.get(invoice.tran_id) ?? [],
			paymentsByTran.get(invoice.tran_id) ?? [],
			store,
			index,
			options,
		);
		sales.push(built.sale);
		flags.push(...built.flags);
	}
	for (const tranId of linesByTran.keys()) {
		if (!seen.has(tranId)) {
			flags.push(
				flag(
					FLAG_CODES.orphanLines,
					"sale-detail rows exist for an invoice missing from the sale report",
					"warn",
					tranId,
				),
			);
		}
	}
	sales.sort(
		(left, right) =>
			left.soldAt.getTime() - right.soldAt.getTime() ||
			left.externalId.localeCompare(right.externalId),
	);
	return { sales, flags };
}
