import type { IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DiscountedInvoice, DiscountRow } from "../ingest.js";

export interface StoreDiscountRow extends DiscountRow {
	readonly storeId: string;
	readonly businessDate: IsoDate;
}

export interface StoreDiscountedInvoice extends DiscountedInvoice {
	readonly storeId: string;
	readonly businessDate: IsoDate;
}

export function discountRows(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): StoreDiscountRow[] {
	const rows: StoreDiscountRow[] = [];
	for (const visible of store.visibleStores(storeIds)) {
		for (const day of store.daysOf(visible, from, to)) {
			for (const row of day.discounts) {
				rows.push({ ...row, storeId: visible.id, businessDate: day.date });
			}
		}
	}
	return rows;
}

export function discountedInvoices(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): Map<string, StoreDiscountedInvoice> {
	const invoices = new Map<string, StoreDiscountedInvoice>();
	for (const visible of store.visibleStores(storeIds)) {
		for (const day of store.daysOf(visible, from, to)) {
			for (const invoice of day.discountedInvoices) {
				invoices.set(
					discountedInvoiceKey(visible.id, invoice.invoiceExternalId),
					{
						...invoice,
						storeId: visible.id,
						businessDate: day.date,
					},
				);
			}
		}
	}
	return invoices;
}

export function discountedInvoiceKey(
	storeId: string,
	invoiceExternalId: string,
): string {
	return `${storeId}\u0000${invoiceExternalId}`;
}
