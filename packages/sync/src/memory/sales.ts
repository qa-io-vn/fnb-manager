import { shiftIsoDate } from "@fnb/core";
import { invoiceDigest, lineSetKey } from "../digest.js";
import { formatMoney, parseNumeric } from "../numeric.js";
import type { DateRange } from "../repository.js";
import type {
	AdjustmentWrite,
	InvoiceEventRow,
	InvoiceRow,
	LocalDayTotal,
	ShiftPaymentTotal,
	StatusChange,
	StoreDayWrite,
	StoreWindowState,
	TableCounts,
} from "../rows.js";
import { byText, inRange, type MemoryState } from "./tables.js";

export function loadStoreWindow(
	state: MemoryState,
	storeId: string,
	range: DateRange,
	referencedExternalIds: readonly string[],
): StoreWindowState {
	const { tables } = state;
	const referenced = new Set(referencedExternalIds);
	const invoices = tables.invoices
		.filter(
			(invoice) =>
				invoice.store_id === storeId &&
				(inRange(invoice.business_date, range) ||
					referenced.has(invoice.external_id)),
		)
		.sort((left, right) => byText(left.external_id, right.external_id))
		.map((invoice) => {
			const lines = tables.lines.filter(
				(line) => line.invoice_id === invoice.id,
			);
			const payments = tables.payments.filter(
				(payment) => payment.invoice_id === invoice.id,
			);
			return {
				external_id: invoice.external_id,
				business_date: invoice.business_date,
				sold_at: invoice.sold_at,
				status: invoice.status,
				net_amount: invoice.net_amount,
				digest: invoiceDigest(invoice, lines, payments),
				line_set: lineSetKey(lines),
			};
		});
	const ids = new Set([
		...invoices.map((invoice) => invoice.external_id),
		...referenced,
	]);
	const events = tables.events
		.filter(
			(event) =>
				event.store_id === storeId && ids.has(event.invoice_external_id),
		)
		.map((event) => ({
			invoice_external_id: event.invoice_external_id,
			kind: event.kind,
			source: event.source,
			occurred_at: event.occurred_at,
		}))
		.sort((left, right) =>
			byText(
				`${left.invoice_external_id}|${left.occurred_at}`,
				`${right.invoice_external_id}|${right.occurred_at}`,
			),
		);
	return { invoices, events };
}

function upsertInvoice(
	state: MemoryState,
	row: InvoiceRow,
	stamp: string,
): string {
	const existing = state.tables.invoices.find(
		(candidate) =>
			candidate.store_id === row.store_id &&
			candidate.external_id === row.external_id,
	);
	if (existing) {
		Object.assign(existing, structuredClone(row), { synced_at: stamp });
		return existing.id;
	}
	const id = state.nextId("invoice");
	state.tables.invoices.push({ ...structuredClone(row), id, synced_at: stamp });
	return id;
}

function assertUniqueLine(
	state: MemoryState,
	invoiceId: string,
	externalId: string,
): void {
	if (
		state.tables.lines.some(
			(line) =>
				line.invoice_id === invoiceId && line.external_id === externalId,
		)
	) {
		throw new Error(
			`duplicate key value violates unique constraint on invoice_lines (${externalId})`,
		);
	}
}

function changeStatuses(
	state: MemoryState,
	storeId: string,
	changes: readonly StatusChange[],
	stamp: string,
): number {
	let changed = 0;
	for (const change of changes) {
		const invoice = state.tables.invoices.find(
			(candidate) =>
				candidate.store_id === storeId &&
				candidate.external_id === change.external_id,
		);
		if (invoice && change.from.includes(invoice.status)) {
			invoice.status = change.status;
			invoice.synced_at = stamp;
			changed += 1;
		}
	}
	return changed;
}

function insertEvents(
	state: MemoryState,
	events: readonly InvoiceEventRow[],
	stamp: string,
): number {
	let inserted = 0;
	for (const event of events) {
		const duplicate = state.tables.events.some(
			(candidate) =>
				candidate.store_id === event.store_id &&
				candidate.invoice_external_id === event.invoice_external_id &&
				candidate.kind === event.kind &&
				candidate.occurred_at === event.occurred_at,
		);
		if (duplicate) {
			continue;
		}
		const invoice = state.tables.invoices.find(
			(candidate) =>
				candidate.store_id === event.store_id &&
				candidate.external_id === event.invoice_external_id,
		);
		state.tables.events.push({
			...structuredClone(event),
			id: state.nextId("event"),
			invoice_id: invoice?.id ?? null,
			created_at: stamp,
		});
		inserted += 1;
	}
	return inserted;
}

export function applyStoreDay(
	state: MemoryState,
	write: StoreDayWrite,
): TableCounts {
	const counts: TableCounts = {
		invoices: 0,
		invoice_lines: 0,
		invoice_payments: 0,
		invoice_events: 0,
	};
	const stamp = state.timestamp();
	for (const sale of write.sales) {
		const invoiceId = upsertInvoice(state, sale.invoice, stamp);
		state.tables.lines = state.tables.lines.filter(
			(line) => line.invoice_id !== invoiceId,
		);
		state.tables.payments = state.tables.payments.filter(
			(payment) => payment.invoice_id !== invoiceId,
		);
		for (const line of sale.lines) {
			assertUniqueLine(state, invoiceId, line.external_id);
			state.tables.lines.push({
				...structuredClone(line),
				id: state.nextId("line"),
				invoice_id: invoiceId,
			});
		}
		for (const payment of sale.payments) {
			state.tables.payments.push({
				...structuredClone(payment),
				id: state.nextId("payment"),
				invoice_id: invoiceId,
			});
		}
		counts.invoices = (counts.invoices ?? 0) + 1;
		counts.invoice_lines = (counts.invoice_lines ?? 0) + sale.lines.length;
		counts.invoice_payments =
			(counts.invoice_payments ?? 0) + sale.payments.length;
	}
	counts.invoices =
		(counts.invoices ?? 0) +
		changeStatuses(state, write.store_id, write.status_changes, stamp);
	counts.invoice_events = insertEvents(state, write.events, stamp);
	return counts;
}

export function applyAdjustments(
	state: MemoryState,
	write: AdjustmentWrite,
): TableCounts {
	const stamp = state.timestamp();
	return {
		invoice_events: insertEvents(state, write.events, stamp),
		invoices: changeStatuses(
			state,
			write.store_id,
			write.status_changes,
			stamp,
		),
	};
}

export function localDayTotals(
	state: MemoryState,
	storeId: string,
	range: DateRange,
): LocalDayTotal[] {
	const totals = new Map<string, { count: number; net: number }>();
	for (const invoice of state.tables.invoices) {
		if (
			invoice.store_id !== storeId ||
			invoice.status === "voided" ||
			!inRange(invoice.business_date, range)
		) {
			continue;
		}
		const total = totals.get(invoice.business_date) ?? { count: 0, net: 0 };
		total.count += 1;
		total.net += parseNumeric(invoice.net_amount);
		totals.set(invoice.business_date, total);
	}
	return [...totals.entries()]
		.sort(([left], [right]) => byText(left, right))
		.map(([date, total]) => ({
			business_date: date,
			invoice_count: total.count,
			net_amount: formatMoney(total.net),
		}));
}

export function shiftPaymentTotals(
	state: MemoryState,
	storeId: string,
	range: DateRange,
	shiftExternalIds: readonly string[],
): ShiftPaymentTotal[] {
	const wanted = new Set(shiftExternalIds);
	const widened = {
		from: shiftIsoDate(range.from, -1),
		to: shiftIsoDate(range.to, 1),
	};
	const totals = new Map<string, ShiftPaymentTotal & { sum: number }>();
	for (const invoice of state.tables.invoices) {
		const shiftId = invoice.shift_external_id;
		if (
			invoice.store_id !== storeId ||
			invoice.status === "voided" ||
			shiftId === null ||
			!wanted.has(shiftId) ||
			!inRange(invoice.business_date, widened)
		) {
			continue;
		}
		for (const payment of state.tables.payments) {
			if (payment.invoice_id !== invoice.id) {
				continue;
			}
			const methodId = payment.payment_method_external_id;
			const key = `${shiftId}|${methodId ?? ""}`;
			const total = totals.get(key) ?? {
				shift_external_id: shiftId,
				payment_method_external_id: methodId,
				amount: "0.00",
				sum: 0,
			};
			total.sum += parseNumeric(payment.amount);
			totals.set(key, total);
		}
	}
	return [...totals.entries()]
		.sort(([left], [right]) => byText(left, right))
		.map(([, total]) => ({
			shift_external_id: total.shift_external_id,
			payment_method_external_id: total.payment_method_external_id,
			amount: formatMoney(total.sum),
		}));
}
