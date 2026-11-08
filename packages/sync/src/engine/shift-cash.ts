import type { CanonicalSale, CanonicalShift, PaymentKind } from "@fnb/core";
import { mapShift } from "../mapping/shift.js";
import { parseNumeric } from "../numeric.js";
import type { ShiftPaymentTotal, TableCounts } from "../rows.js";
import { byExternalIdText, type StoreScope } from "./store-window-context.js";

function fallbackKinds(
	sales: readonly CanonicalSale[],
): ReadonlyMap<string, PaymentKind> {
	return new Map(
		sales.flatMap((sale) =>
			sale.payments.map(
				(payment) => [payment.methodExternalId, payment.kind] as const,
			),
		),
	);
}

export function cashByShift(
	totals: readonly ShiftPaymentTotal[],
	kinds: Readonly<Record<string, PaymentKind>>,
	fallback: ReadonlyMap<string, PaymentKind>,
): Map<string, number> {
	const cash = new Map<string, number>();
	for (const total of totals) {
		const methodId = total.payment_method_external_id ?? "";
		const kind = kinds[methodId] ?? fallback.get(methodId);
		if (kind === "cash") {
			cash.set(
				total.shift_external_id,
				(cash.get(total.shift_external_id) ?? 0) + parseNumeric(total.amount),
			);
		}
	}
	return cash;
}

export async function writeShifts(
	scope: StoreScope,
	shifts: readonly CanonicalShift[],
	sales: readonly CanonicalSale[],
	record: (
		planned: TableCounts,
		apply: () => Promise<TableCounts>,
	) => Promise<void>,
): Promise<number> {
	const { store, context } = scope;
	const ordered = [...shifts].sort((left, right) =>
		byExternalIdText(left.externalId, right.externalId),
	);
	if (ordered.length === 0) {
		return 0;
	}
	const totals = await context.repository.shiftPaymentTotals(
		store.id,
		{ from: context.window.fromDate, to: context.window.toDate },
		ordered.map((shift) => shift.externalId),
	);
	const cash = cashByShift(totals, context.paymentKinds, fallbackKinds(sales));
	const rows = ordered.map((shift) =>
		mapShift(shift, {
			tenantId: store.tenant_id,
			storeId: store.id,
			cashByShift: cash,
		}),
	);
	await record({ shifts: rows.length }, () =>
		context.repository.upsertShifts(store.id, rows),
	);
	return rows.length;
}
