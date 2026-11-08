import type { ISql } from "postgres";
import {
	type DigestInvoice,
	type DigestLine,
	type DigestPayment,
	invoiceDigest,
	lineSetKey,
} from "../digest.js";
import type { DateRange } from "../repository.js";
import {
	type AdjustmentWrite,
	type ExistingEvent,
	type ExistingInvoice,
	INVOICE_DIGEST_COLUMNS,
	type InvoiceEventRow,
	type InvoiceStatus,
	LINE_DIGEST_COLUMNS,
	type LocalDayTotal,
	PAYMENT_DIGEST_COLUMNS,
	type SaleWrite,
	type ShiftPaymentTotal,
	type StatusChange,
	type StoreDayWrite,
	type StoreWindowState,
	type TableCounts,
} from "../rows.js";
import {
	EVENT_COLUMNS,
	INVOICE_COLUMNS,
	INVOICE_KEY_COLUMNS,
	LINE_COLUMNS,
	PAYMENT_COLUMNS,
	selectList,
} from "./columns.js";
import { lockStore } from "./locks.js";
import { storeSalePayloads } from "./payloads.js";
import { chunkRows, excludedAssignments, toSqlRow } from "./values.js";

type StoredDigestRow = Omit<
	DigestInvoice,
	"sold_at" | "opened_at" | "closed_at"
> & {
	id: string;
	status: InvoiceStatus;
	sold_at: Date;
	opened_at: Date | null;
	closed_at: Date | null;
};

type DigestInvoiceRow = DigestInvoice & {
	id: string;
	status: InvoiceStatus;
};

function withIsoTimestamps(row: StoredDigestRow): DigestInvoiceRow {
	return {
		...row,
		sold_at: row.sold_at.toISOString(),
		opened_at: row.opened_at?.toISOString() ?? null,
		closed_at: row.closed_at?.toISOString() ?? null,
	};
}

function groupBy<T>(
	rows: readonly T[],
	key: (row: T) => string,
): Map<string, T[]> {
	const groups = new Map<string, T[]>();
	for (const row of rows) {
		const value = key(row);
		groups.set(value, [...(groups.get(value) ?? []), row]);
	}
	return groups;
}

export async function loadStoreWindow(
	sql: ISql,
	storeId: string,
	range: DateRange,
	referencedExternalIds: readonly string[],
): Promise<StoreWindowState> {
	const invoiceRows = (
		await sql<StoredDigestRow[]>`
			select i.id, i.status::text as status, ${sql.unsafe(selectList("i", INVOICE_DIGEST_COLUMNS))}
			from public.invoices i
			where i.store_id = ${storeId}
				and (i.business_date between ${range.from}::date and ${range.to}::date
					or i.external_id = any(${[...referencedExternalIds]}::text[]))
			order by i.external_id
		`
	).map(withIsoTimestamps);
	const invoiceIds = invoiceRows.map((row) => row.id);
	const lineRows =
		invoiceIds.length === 0
			? []
			: await sql<(DigestLine & { invoice_id: string })[]>`
					select l.invoice_id, ${sql.unsafe(selectList("l", LINE_DIGEST_COLUMNS))}
					from public.invoice_lines l
					where l.invoice_id = any(${invoiceIds}::uuid[])
				`;
	const paymentRows =
		invoiceIds.length === 0
			? []
			: await sql<(DigestPayment & { invoice_id: string })[]>`
					select p.invoice_id, ${sql.unsafe(selectList("p", PAYMENT_DIGEST_COLUMNS))}
					from public.invoice_payments p
					where p.invoice_id = any(${invoiceIds}::uuid[])
				`;
	const linesByInvoice = groupBy(lineRows, (row) => row.invoice_id);
	const paymentsByInvoice = groupBy(paymentRows, (row) => row.invoice_id);
	const invoices: ExistingInvoice[] = invoiceRows.map((row) => {
		const lines = linesByInvoice.get(row.id) ?? [];
		const payments = paymentsByInvoice.get(row.id) ?? [];
		return {
			external_id: row.external_id,
			business_date: row.business_date,
			sold_at: row.sold_at,
			status: row.status,
			net_amount: row.net_amount,
			digest: invoiceDigest(row, lines, payments),
			line_set: lineSetKey(lines),
		};
	});
	const eventIds = [
		...new Set([
			...invoices.map((invoice) => invoice.external_id),
			...referencedExternalIds,
		]),
	];
	const events = (
		await sql<(Omit<ExistingEvent, "occurred_at"> & { occurred_at: Date })[]>`
			select invoice_external_id, kind::text as kind, source, occurred_at
			from public.invoice_events
			where store_id = ${storeId}
				and invoice_external_id = any(${eventIds}::text[])
			order by invoice_external_id, occurred_at, kind
		`
	).map((row) => ({ ...row, occurred_at: row.occurred_at.toISOString() }));
	return { invoices, events };
}

const INVOICE_UPDATE_COLUMNS = INVOICE_COLUMNS.filter(
	(column) => !INVOICE_KEY_COLUMNS.includes(column),
);

async function upsertSales(
	sql: ISql,
	sales: readonly SaleWrite[],
): Promise<TableCounts> {
	const counts: TableCounts = {
		invoices: 0,
		invoice_lines: 0,
		invoice_payments: 0,
	};
	for (const chunk of chunkRows(sales, INVOICE_COLUMNS.length)) {
		const rows = chunk.map((sale) =>
			toSqlRow({ ...sale.invoice, raw: null }, INVOICE_COLUMNS),
		);
		const ids = await sql<{ id: string; external_id: string }[]>`
			insert into public.invoices ${sql(rows, INVOICE_COLUMNS)}
			on conflict (store_id, external_id)
			do update set ${sql.unsafe(excludedAssignments(INVOICE_UPDATE_COLUMNS))}, synced_at = now()
			returning id, external_id
		`;
		const idByExternal = new Map(ids.map((row) => [row.external_id, row.id]));
		const invoiceIds = [...idByExternal.values()];
		await sql`delete from public.invoice_lines where invoice_id = any(${invoiceIds}::uuid[])`;
		await sql`delete from public.invoice_payments where invoice_id = any(${invoiceIds}::uuid[])`;
		const lineColumns = ["invoice_id", ...LINE_COLUMNS];
		const lines = chunk.flatMap((sale) =>
			sale.lines.map((line) =>
				toSqlRow(
					{
						...line,
						invoice_id: idByExternal.get(sale.invoice.external_id),
						raw: null,
					},
					lineColumns,
				),
			),
		);
		for (const lineChunk of chunkRows(lines, lineColumns.length)) {
			await sql`insert into public.invoice_lines ${sql(lineChunk, lineColumns)}`;
		}
		const paymentColumns = ["invoice_id", ...PAYMENT_COLUMNS];
		const payments = chunk.flatMap((sale) =>
			sale.payments.map((payment) =>
				toSqlRow(
					{
						...payment,
						invoice_id: idByExternal.get(sale.invoice.external_id),
						raw: null,
					},
					paymentColumns,
				),
			),
		);
		for (const paymentChunk of chunkRows(payments, paymentColumns.length)) {
			await sql`insert into public.invoice_payments ${sql(paymentChunk, paymentColumns)}`;
		}
		counts.invoices = (counts.invoices ?? 0) + ids.length;
		counts.invoice_lines = (counts.invoice_lines ?? 0) + lines.length;
		counts.invoice_payments = (counts.invoice_payments ?? 0) + payments.length;
	}
	return counts;
}

async function changeStatuses(
	sql: ISql,
	storeId: string,
	changes: readonly StatusChange[],
): Promise<number> {
	const groups = groupBy(
		changes,
		(change) => `${change.status}|${[...change.from].sort().join(",")}`,
	);
	let changed = 0;
	for (const group of groups.values()) {
		const [first] = group;
		if (!first) {
			continue;
		}
		const result = await sql`
			update public.invoices
			set status = ${first.status}::public.invoice_status, synced_at = now()
			where store_id = ${storeId}
				and external_id = any(${group.map((change) => change.external_id)}::text[])
				and status = any(${first.from}::public.invoice_status[])
		`;
		changed += result.count;
	}
	return changed;
}

async function insertEvents(
	sql: ISql,
	storeId: string,
	events: readonly InvoiceEventRow[],
): Promise<number> {
	if (events.length === 0) {
		return 0;
	}
	const externalIds = [
		...new Set(events.map((event) => event.invoice_external_id)),
	];
	const invoices = await sql<{ id: string; external_id: string }[]>`
		select id, external_id from public.invoices
		where store_id = ${storeId} and external_id = any(${externalIds}::text[])
	`;
	const idByExternal = new Map(
		invoices.map((row) => [row.external_id, row.id]),
	);
	const columns = ["invoice_id", ...EVENT_COLUMNS];
	let inserted = 0;
	for (const chunk of chunkRows(events, columns.length)) {
		const rows = chunk.map((event) =>
			toSqlRow(
				{
					...event,
					invoice_id: idByExternal.get(event.invoice_external_id) ?? null,
				},
				columns,
			),
		);
		const result = await sql`
			insert into public.invoice_events ${sql(rows, columns)}
			on conflict (store_id, invoice_external_id, kind, occurred_at) do nothing
		`;
		inserted += result.count;
	}
	return inserted;
}

export async function applyStoreDay(
	sql: ISql,
	write: StoreDayWrite,
): Promise<TableCounts> {
	await lockStore(sql, write.store_id);
	await storeSalePayloads(sql, write);
	const counts = await upsertSales(sql, write.sales);
	counts.invoices =
		(counts.invoices ?? 0) +
		(await changeStatuses(sql, write.store_id, write.status_changes));
	counts.invoice_events = await insertEvents(sql, write.store_id, write.events);
	return counts;
}

export async function applyAdjustments(
	sql: ISql,
	write: AdjustmentWrite,
): Promise<TableCounts> {
	await lockStore(sql, write.store_id);
	const invoiceEvents = await insertEvents(sql, write.store_id, write.events);
	const invoices = await changeStatuses(
		sql,
		write.store_id,
		write.status_changes,
	);
	return { invoice_events: invoiceEvents, invoices };
}

export async function localDayTotals(
	sql: ISql,
	storeId: string,
	range: DateRange,
): Promise<LocalDayTotal[]> {
	return sql<LocalDayTotal[]>`
		select business_date::text as business_date,
			count(*)::int as invoice_count,
			coalesce(sum(net_amount), 0)::text as net_amount
		from public.invoices
		where store_id = ${storeId}
			and business_date between ${range.from}::date and ${range.to}::date
			and status <> 'voided'
		group by business_date
		order by business_date
	`;
}

export async function shiftPaymentTotals(
	sql: ISql,
	storeId: string,
	range: DateRange,
	shiftExternalIds: readonly string[],
): Promise<ShiftPaymentTotal[]> {
	if (shiftExternalIds.length === 0) {
		return [];
	}
	return sql<ShiftPaymentTotal[]>`
		select i.shift_external_id, p.payment_method_external_id, sum(p.amount)::text as amount
		from public.invoices i
		join public.invoice_payments p on p.invoice_id = i.id
		where i.store_id = ${storeId}
			and i.status <> 'voided'
			and i.shift_external_id = any(${[...shiftExternalIds]}::text[])
			and i.business_date between ${range.from}::date - 1 and ${range.to}::date + 1
		group by i.shift_external_id, p.payment_method_external_id
		order by i.shift_external_id, p.payment_method_external_id nulls first
	`;
}
