import { instantOnBusinessDate } from "@fnb/core";
import type {
	InvoiceLineRow,
	InvoiceRow,
	InvoiceStatus,
	PaymentMethodRow,
	PaymentRow,
	StoreRow,
} from "../data/row-source";
import type { TodayRows } from "./today";

export const TIME_ZONE = "Asia/Ho_Chi_Minh";

export function testStore(
	id: string,
	overrides: Partial<StoreRow> = {},
): StoreRow {
	return {
		id,
		tenantId: "tenant-a",
		name: `Store ${id}`,
		code: id,
		timeZone: TIME_ZONE,
		businessDayStartMinutes: 0,
		posAccountId: "account-a",
		...overrides,
	};
}

export function localInstant(
	store: StoreRow,
	businessDate: string,
	time: string,
): Date {
	const [hours = 0, minutes = 0] = time.split(":").map(Number);
	return instantOnBusinessDate(
		businessDate,
		hours * 60 + minutes,
		store.timeZone,
		store.businessDayStartMinutes,
	);
}

let sequence = 0;

export function sale(
	store: StoreRow,
	businessDate: string,
	time: string,
	netAmount: number,
	status: InvoiceStatus = "completed",
): InvoiceRow {
	sequence += 1;
	return {
		id: `invoice-${sequence}`,
		storeId: store.id,
		businessDate,
		soldAt: localInstant(store, businessDate, time).toISOString(),
		netAmount,
		status,
	};
}

export function line(
	invoice: InvoiceRow,
	itemName: string,
	netAmount: number,
	lineKind: InvoiceLineRow["lineKind"] = "item",
	quantity = 1,
): InvoiceLineRow {
	return {
		invoiceId: invoice.id,
		storeId: invoice.storeId,
		lineKind,
		itemExternalId: itemName,
		itemName,
		quantity,
		netAmount,
	};
}

export function payment(
	invoice: InvoiceRow,
	methodExternalId: string,
	amount: number,
): PaymentRow {
	return {
		invoiceId: invoice.id,
		storeId: invoice.storeId,
		businessDate: invoice.businessDate,
		methodExternalId,
		methodName: methodExternalId,
		amount,
	};
}

export const testMethods: PaymentMethodRow[] = [
	{
		posAccountId: "account-a",
		externalId: "CASH",
		name: "Tiền mặt",
		kind: "cash",
	},
	{
		posAccountId: "account-a",
		externalId: "QR",
		name: "Ví QR",
		kind: "ewallet",
	},
	{
		posAccountId: "account-b",
		externalId: "CASH",
		name: "Chuyển khoản",
		kind: "bank_transfer",
	},
];

export function rowsOf(partial: Partial<TodayRows>): TodayRows {
	return {
		invoices: [],
		lines: [],
		payments: [],
		paymentMethods: testMethods,
		excludedDates: new Set(),
		...partial,
	};
}
