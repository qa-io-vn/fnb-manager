import { businessDayStart } from "@fnb/core";
import {
	addDays,
	type IsoDate,
	periodSeriesRow,
	storeCoverageRow,
} from "@fnb/reports";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { afterCompositeKey } from "../data/paginate";
import type {
	InvoiceRecord,
	LineRecord,
	PaymentRecord,
	RecordOf,
	ShiftRecord,
} from "./columns";
import { personalColumnsOf } from "./columns";
import type { StoreTableId } from "./plan";
import {
	type ControlTotals,
	controlTotalsOf,
	controlTotalsRow,
} from "./totals";

export const EXPORT_PAGE_SIZE = 1000;
export const MAX_STORE_IDS_PER_CALL = 50;

export function storeIdChunks(storeIds: readonly string[]): string[][] {
	const chunks: string[][] = [];
	for (
		let start = 0;
		start < storeIds.length;
		start += MAX_STORE_IDS_PER_CALL
	) {
		chunks.push(storeIds.slice(start, start + MAX_STORE_IDS_PER_CALL));
	}
	return chunks;
}

export interface StoreMonthScope {
	readonly storeId: string;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
}

export interface Received<T> {
	readonly value: T;
	readonly bytes: number;
}

export interface PageRequest<T extends StoreTableId> {
	readonly table: T;
	readonly scope: StoreMonthScope;
	readonly after: RecordOf<T> | null;
	readonly pageSize: number;
	readonly personal: boolean;
	readonly signal?: AbortSignal | undefined;
}

export type DailySummaryRecord = z.infer<typeof periodSeriesRow>;

export interface StoreLabel {
	readonly storeId: string;
	readonly label: string;
}

export interface ExportReader {
	page<T extends StoreTableId>(
		request: PageRequest<T>,
	): Promise<Received<RecordOf<T>[]>>;
	controlTotals(
		scope: Pick<StoreMonthScope, "storeId" | "from" | "to">,
		signal?: AbortSignal,
	): Promise<Received<ControlTotals>>;
	dailySummary(
		storeIds: readonly string[],
		from: IsoDate,
		to: IsoDate,
		includeStores: boolean,
		signal?: AbortSignal,
	): Promise<Received<DailySummaryRecord[]>>;
	storeLabels(storeIds: readonly string[]): Promise<StoreLabel[]>;
	historyStart(
		storeIds: readonly string[],
		asOf: IsoDate,
	): Promise<IsoDate | null>;
}

export function abortError(): DOMException {
	return new DOMException("The export was stopped", "AbortError");
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw abortError();
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function recordKey<T extends StoreTableId>(
	table: T,
	record: RecordOf<T>,
): string {
	switch (table) {
		case "invoices":
			return (record as InvoiceRecord).id;
		case "invoice_lines": {
			const line = record as LineRecord;
			return `${line.invoice_id}\u0000${line.external_id}`;
		}
		case "invoice_payments": {
			const payment = record as PaymentRecord;
			return `${payment.invoice_id}\u0000${payment.sequence_no}`;
		}
		default:
			return (record as ShiftRecord).id;
	}
}

export interface TableRead<T extends StoreTableId> {
	readonly records: RecordOf<T>[];
	readonly bytes: number;
	readonly pages: number;
}

export interface ReadTableOptions<T extends StoreTableId> {
	readonly table: T;
	readonly scope: StoreMonthScope;
	readonly expectedRows: number;
	readonly pageSize?: number | undefined;
	readonly personal: boolean;
	readonly signal?: AbortSignal | undefined;
	readonly onPage?: ((rowsRead: number) => void) | undefined;
}

export async function readTable<T extends StoreTableId>(
	reader: ExportReader,
	options: ReadTableOptions<T>,
): Promise<TableRead<T>> {
	const pageSize = options.pageSize ?? EXPORT_PAGE_SIZE;
	if (!Number.isInteger(pageSize) || pageSize < 1) {
		throw new RangeError(`page size must be a positive integer: ${pageSize}`);
	}
	const byKey = new Map<string, RecordOf<T>>();
	let after: RecordOf<T> | null = null;
	let bytes = 0;
	let pages = 0;
	for (;;) {
		throwIfAborted(options.signal);
		const received: Received<RecordOf<T>[]> = await reader.page({
			table: options.table,
			scope: options.scope,
			after,
			pageSize,
			personal: options.personal,
			signal: options.signal,
		});
		pages += 1;
		bytes += received.bytes;
		for (const record of received.value) {
			byKey.set(recordKey(options.table, record), record);
		}
		options.onPage?.(byKey.size);
		const last = received.value.at(-1);
		if (last === undefined) break;
		after = last;
		if (received.value.length < pageSize && byKey.size >= options.expectedRows)
			break;
	}
	return { records: [...byKey.values()], bytes, pages };
}

export function receivedBytes(data: unknown): number {
	return new TextEncoder().encode(JSON.stringify(data ?? null)).length;
}

const numeric = z.union([z.number(), z.string()]);
const optionalNumeric = numeric.nullable();
const text = z.string();
const optionalText = z.string().nullable();
const optionalPersonalText = z.string().nullable().optional();

const invoiceRecord = z.object({
	id: text,
	external_id: text,
	receipt_no: optionalText,
	business_date: text,
	sold_at: text,
	opened_at: optionalText,
	closed_at: optionalText,
	status: text,
	table_name: optionalText,
	area_name: optionalText,
	sale_type: optionalText,
	source_name: optionalText,
	shift_external_id: optionalText,
	device_code: optionalText,
	guest_count: z.number().int().nullable(),
	gross_amount: numeric,
	item_discount_amount: numeric,
	bill_discount_amount: numeric,
	extra_discount_amount: numeric,
	bill_discount_name: optionalText,
	voucher_name: optionalText,
	voucher_amount: numeric,
	partner_marketing_amount: numeric,
	service_charge_amount: numeric,
	shipping_fee_amount: numeric,
	vat_amount: numeric,
	net_amount: numeric,
	paid_amount: numeric,
	primary_payment_method_name: optionalText,
	customer_phone: optionalPersonalText,
	customer_name: optionalPersonalText,
	employee_name: optionalPersonalText,
	voucher_code: optionalPersonalText,
});

const lineRecord = z.object({
	invoice_id: text,
	external_id: text,
	parent_line_external_id: optionalText,
	line_kind: text,
	item_external_id: optionalText,
	item_name: text,
	base_name: optionalText,
	size_label: optionalText,
	item_type_name: optionalText,
	item_class_name: optionalText,
	unit_name: optionalText,
	package_external_id: optionalText,
	quantity: numeric,
	list_unit_price: optionalNumeric,
	unit_price: numeric,
	gross_amount: numeric,
	discount_amount: numeric,
	net_amount: numeric,
	promotion_name: optionalText,
	note: optionalPersonalText,
	invoices: z.object({ external_id: text, business_date: text }),
});

const paymentRecord = z.object({
	invoice_id: text,
	business_date: text,
	sequence_no: z.number().int(),
	payment_method_external_id: optionalText,
	payment_method_name: optionalText,
	amount: numeric,
	fee_amount: numeric,
	reference_no: optionalPersonalText,
	partner_transaction_id: optionalPersonalText,
	invoices: z.object({ external_id: text }),
});

const shiftRecord = z.object({
	id: text,
	external_id: text,
	name: optionalPersonalText,
	opened_at: text,
	closed_at: optionalText,
	orders_count: z.number().int(),
	sales_amount: numeric,
	opening_float_amount: optionalNumeric,
	expected_cash_amount: optionalNumeric,
	cash_drawer_amount: optionalNumeric,
	cash_variance_amount: optionalNumeric,
	changed_after_close: z.boolean(),
	status: optionalText,
	device_code: optionalText,
	cashier_name: optionalPersonalText,
});

const RECORD_SCHEMAS: {
	readonly [T in StoreTableId]: z.ZodType<RecordOf<T>>;
} = {
	invoices: invoiceRecord,
	invoice_lines: lineRecord,
	invoice_payments: paymentRecord,
	shifts: shiftRecord,
};

const BASE_SELECTS: Readonly<Record<StoreTableId, readonly string[]>> = {
	invoices: [
		"id",
		"external_id",
		"receipt_no",
		"business_date",
		"sold_at",
		"opened_at",
		"closed_at",
		"status",
		"table_name",
		"area_name",
		"sale_type",
		"source_name",
		"shift_external_id",
		"device_code",
		"guest_count",
		"gross_amount",
		"item_discount_amount",
		"bill_discount_amount",
		"extra_discount_amount",
		"bill_discount_name",
		"voucher_name",
		"voucher_amount",
		"partner_marketing_amount",
		"service_charge_amount",
		"shipping_fee_amount",
		"vat_amount",
		"net_amount",
		"paid_amount",
		"primary_payment_method_name",
	],
	invoice_lines: [
		"invoice_id",
		"external_id",
		"parent_line_external_id",
		"line_kind",
		"item_external_id",
		"item_name",
		"base_name",
		"size_label",
		"item_type_name",
		"item_class_name",
		"unit_name",
		"package_external_id",
		"quantity",
		"list_unit_price",
		"unit_price",
		"gross_amount",
		"discount_amount",
		"net_amount",
		"promotion_name",
		"invoices!inner(external_id,business_date)",
	],
	invoice_payments: [
		"invoice_id",
		"business_date",
		"sequence_no",
		"payment_method_external_id",
		"payment_method_name",
		"amount",
		"fee_amount",
		"invoices!inner(external_id)",
	],
	shifts: [
		"id",
		"external_id",
		"opened_at",
		"closed_at",
		"orders_count",
		"sales_amount",
		"opening_float_amount",
		"expected_cash_amount",
		"cash_drawer_amount",
		"cash_variance_amount",
		"changed_after_close",
		"status",
		"device_code",
	],
};

export function selectList(table: StoreTableId, personal: boolean): string {
	return [
		...BASE_SELECTS[table],
		...(personal ? personalColumnsOf(table) : []),
	].join(",");
}

export function shiftWindow(scope: StoreMonthScope): {
	from: string;
	until: string;
} {
	return {
		from: businessDayStart(
			scope.from,
			scope.timeZone,
			scope.businessDayStartMinutes,
		).toISOString(),
		until: businessDayStart(
			addDays(scope.to, 1),
			scope.timeZone,
			scope.businessDayStartMinutes,
		).toISOString(),
	};
}

export interface ExportResponse {
	readonly data: unknown;
	readonly error: { readonly message: string } | null;
}

export interface ExportQuery extends PromiseLike<ExportResponse> {
	eq(column: string, value: string): ExportQuery;
	gt(column: string, value: string): ExportQuery;
	gte(column: string, value: string): ExportQuery;
	lt(column: string, value: string): ExportQuery;
	lte(column: string, value: string): ExportQuery;
	or(filters: string): ExportQuery;
	order(column: string, options: { ascending: boolean }): ExportQuery;
	limit(count: number): ExportQuery;
	abortSignal(signal: AbortSignal): ExportQuery;
}

export interface ExportRpcCall extends PromiseLike<ExportResponse> {
	abortSignal(signal: AbortSignal): ExportRpcCall;
}

export interface ExportClient {
	from(table: string): { select(columns: string): ExportQuery };
	rpc(name: string, args: Record<string, unknown>): ExportRpcCall;
}

function keysetFilter<T extends StoreTableId>(
	table: T,
	after: RecordOf<T>,
):
	| { kind: "or"; filter: string }
	| { kind: "gt"; column: string; value: string } {
	switch (table) {
		case "invoices": {
			const invoice = after as InvoiceRecord;
			return {
				kind: "or",
				filter: afterCompositeKey(
					{ column: "business_date", value: invoice.business_date },
					{ column: "id", value: invoice.id },
				),
			};
		}
		case "invoice_lines": {
			const line = after as LineRecord;
			return {
				kind: "or",
				filter: afterCompositeKey(
					{ column: "invoice_id", value: line.invoice_id },
					{ column: "external_id", value: line.external_id },
				),
			};
		}
		case "invoice_payments": {
			const payment = after as PaymentRecord;
			return {
				kind: "or",
				filter: afterCompositeKey(
					{ column: "invoice_id", value: payment.invoice_id },
					{ column: "sequence_no", value: payment.sequence_no },
				),
			};
		}
		default:
			return { kind: "gt", column: "id", value: (after as ShiftRecord).id };
	}
}

const ORDER_COLUMNS: Readonly<Record<StoreTableId, readonly string[]>> = {
	invoices: ["business_date", "id"],
	invoice_lines: ["invoice_id", "external_id"],
	invoice_payments: ["invoice_id", "sequence_no"],
	shifts: ["id"],
};

function scoped(
	query: ExportQuery,
	table: StoreTableId,
	scope: StoreMonthScope,
): ExportQuery {
	const byStore = query.eq("store_id", scope.storeId);
	switch (table) {
		case "invoices":
		case "invoice_payments":
			return byStore
				.gte("business_date", scope.from)
				.lte("business_date", scope.to);
		case "invoice_lines":
			return byStore
				.gte("invoices.business_date", scope.from)
				.lte("invoices.business_date", scope.to);
		default: {
			const window = shiftWindow(scope);
			return byStore
				.gte("opened_at", window.from)
				.lt("opened_at", window.until);
		}
	}
}

function failure(name: string, error: { message: string } | null): Error {
	return new Error(`${name}: ${error?.message ?? "no response"}`);
}

const labelRow = z.object({ store_id: z.string(), label: z.string() });

export function createSupabaseExportReader(
	supabase: SupabaseClient,
): ExportReader {
	return createExportReader(supabase as unknown as ExportClient);
}

export function createExportReader(client: ExportClient): ExportReader {
	return {
		async page<T extends StoreTableId>(
			request: PageRequest<T>,
		): Promise<Received<RecordOf<T>[]>> {
			let query = scoped(
				client
					.from(request.table)
					.select(selectList(request.table, request.personal)),
				request.table,
				request.scope,
			);
			if (request.after !== null) {
				const keyset = keysetFilter(request.table, request.after);
				query =
					keyset.kind === "or"
						? query.or(keyset.filter)
						: query.gt(keyset.column, keyset.value);
			}
			for (const column of ORDER_COLUMNS[request.table]) {
				query = query.order(column, { ascending: true });
			}
			query = query.limit(request.pageSize);
			if (request.signal) query = query.abortSignal(request.signal);
			const { data, error } = await query;
			throwIfAborted(request.signal);
			if (error) throw failure(request.table, error);
			const schema = RECORD_SCHEMAS[request.table] as z.ZodType<RecordOf<T>>;
			return {
				value: z.array(schema).parse(data ?? []),
				bytes: receivedBytes(data),
			};
		},

		async controlTotals(scope, signal) {
			let call = client.rpc("export_control_totals", {
				store_ids: [scope.storeId],
				from_date: scope.from,
				to_date: scope.to,
			});
			if (signal) call = call.abortSignal(signal);
			const { data, error } = await call;
			throwIfAborted(signal);
			if (error) throw failure("export_control_totals", error);
			const rows = z.array(controlTotalsRow).parse(data ?? []);
			const row = rows.find(
				(candidate) => candidate.store_id === scope.storeId,
			);
			if (row === undefined) {
				throw new Error("export_control_totals: the store is not visible");
			}
			return { value: controlTotalsOf(row), bytes: receivedBytes(data) };
		},

		async dailySummary(storeIds, from, to, includeStores, signal) {
			let call = client.rpc("period_series", {
				store_ids: [...storeIds],
				grain: "day",
				from_date: from,
				to_date: to,
				include_stores: includeStores,
			});
			if (signal) call = call.abortSignal(signal);
			const { data, error } = await call;
			throwIfAborted(signal);
			if (error) throw failure("period_series", error);
			return {
				value: z.array(periodSeriesRow).parse(data ?? []),
				bytes: receivedBytes(data),
			};
		},

		async storeLabels(storeIds) {
			const labels: StoreLabel[] = [];
			for (const chunk of storeIdChunks(storeIds)) {
				const { data, error } = await client.rpc("store_profiles", {
					store_ids: chunk,
				});
				if (error) throw failure("store_profiles", error);
				for (const row of z.array(labelRow).parse(data ?? [])) {
					labels.push({ storeId: row.store_id, label: row.label });
				}
			}
			return labels;
		},

		async historyStart(storeIds, asOf) {
			const starts: string[] = [];
			for (const chunk of storeIdChunks(storeIds)) {
				const { data, error } = await client.rpc("store_coverage", {
					store_ids: chunk,
					from_date: asOf,
					to_date: asOf,
				});
				if (error) throw failure("store_coverage", error);
				for (const row of z.array(storeCoverageRow).parse(data ?? [])) {
					if (row.history_start !== null) starts.push(row.history_start);
				}
			}
			return starts.sort()[0] ?? null;
		},
	};
}
