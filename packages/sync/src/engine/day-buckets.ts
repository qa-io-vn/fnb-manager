import { businessDate, type CanonicalSale } from "@fnb/core";
import { containsNul } from "../json.js";
import { mapSale } from "../mapping/sale.js";
import { parseNumeric } from "../numeric.js";
import type { ExistingInvoice, SaleWrite } from "../rows.js";
import { allowedDifference } from "./checks.js";
import type { FlagCollector } from "./flags.js";
import type { StoreScope } from "./store-window-context.js";

function uniqueSales(
	sales: readonly CanonicalSale[],
	flags: FlagCollector,
): CanonicalSale[] {
	const byId = new Map<string, CanonicalSale>();
	for (const sale of sales) {
		if (byId.has(sale.externalId)) {
			flags.add("duplicate_sale_id", "warn");
		}
		byId.set(sale.externalId, sale);
	}
	return [...byId.values()];
}

export function salesByDate(
	scope: StoreScope,
	sales: readonly CanonicalSale[],
): Map<string, SaleWrite[]> {
	const { store, context } = scope;
	const byDate = new Map<string, SaleWrite[]>(
		scope.dates.map((date) => [date, []]),
	);
	for (const sale of uniqueSales(sales, context.flags)) {
		const date = businessDate(
			sale.soldAt,
			store.timezone,
			store.business_day_start_minutes,
		);
		if (date !== sale.businessDate) {
			context.flags.add("business_date_reassigned", "warn");
		}
		const bucket = byDate.get(date);
		if (!bucket) {
			context.flags.add("sale_outside_window", "warn");
			continue;
		}
		if (containsNul(sale)) {
			context.flags.add("nul_character_removed", "warn");
		}
		const mapped = mapSale(sale, {
			tenantId: store.tenant_id,
			storeId: store.id,
			posAccountId: store.pos_account_id,
			businessDate: date,
		});
		context.flags.addAll(mapped.flags);
		bucket.push(mapped.write);
	}
	return byDate;
}

export function inspectDay(
	scope: StoreScope,
	sales: readonly SaleWrite[],
): void {
	const { flags, tolerance } = scope.context;
	const counted = sales.filter((sale) => sale.invoice.status !== "voided");
	const receipts = new Set<string>();
	for (const sale of counted) {
		const receipt = sale.invoice.receipt_no;
		if (receipt === null) {
			continue;
		}
		if (receipts.has(receipt)) {
			flags.add("duplicate_receipt_key", "info");
		}
		receipts.add(receipt);
	}
	const paid = counted.reduce(
		(sum, sale) => sum + parseNumeric(sale.invoice.paid_amount),
		0,
	);
	const tendered = counted.reduce(
		(sum, sale) =>
			sum +
			sale.payments.reduce(
				(inner, payment) => inner + parseNumeric(payment.amount),
				0,
			),
		0,
	);
	if (Math.abs(paid - tendered) > allowedDifference(paid, tolerance)) {
		flags.add("payments_differ_from_paid", "warn");
	}
}

export function groupExisting(
	invoices: readonly ExistingInvoice[],
): Map<string, ExistingInvoice[]> {
	const byDate = new Map<string, ExistingInvoice[]>();
	for (const invoice of invoices) {
		byDate.set(invoice.business_date, [
			...(byDate.get(invoice.business_date) ?? []),
			invoice,
		]);
	}
	return byDate;
}

export function currentBusinessDate(
	scope: StoreScope,
	invoice: Pick<ExistingInvoice, "sold_at">,
): string {
	return businessDate(
		new Date(invoice.sold_at),
		scope.store.timezone,
		scope.store.business_day_start_minutes,
	);
}
