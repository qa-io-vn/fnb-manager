import { businessDate, wallClockIn } from "@fnb/core";
import { PERIOD_TOTAL_COLUMNS } from "@fnb/reports";
import type { ExportStore, ExportTableId, StoreTableId } from "./plan";

export type ExportCell = string | number | boolean | null;
export type ExportRow = Readonly<Record<string, ExportCell>>;

export interface ExportColumn {
	readonly key: string;
	readonly personal: boolean;
}

function plain(...keys: readonly string[]): ExportColumn[] {
	return keys.map((key) => ({ key, personal: false }));
}

function personal(...keys: readonly string[]): ExportColumn[] {
	return keys.map((key) => ({ key, personal: true }));
}

export const INVOICE_COLUMNS: readonly ExportColumn[] = [
	...plain(
		"store_name",
		"id",
		"external_id",
		"receipt_no",
		"business_date",
		"sold_at",
		"sold_at_local",
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
	),
	...personal(
		"customer_phone",
		"customer_name",
		"employee_name",
		"voucher_code",
	),
];

export const LINE_COLUMNS: readonly ExportColumn[] = [
	...plain(
		"store_name",
		"invoice_id",
		"invoice_external_id",
		"business_date",
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
	),
	...personal("note"),
];

export const PAYMENT_COLUMNS: readonly ExportColumn[] = [
	...plain(
		"store_name",
		"invoice_id",
		"invoice_external_id",
		"business_date",
		"sequence_no",
		"payment_method_external_id",
		"payment_method_name",
		"amount",
		"fee_amount",
	),
	...personal("reference_no", "partner_transaction_id"),
];

export const SHIFT_COLUMNS: readonly ExportColumn[] = [
	...plain("store_name", "id", "external_id"),
	...personal("name"),
	...plain(
		"business_date",
		"opened_at",
		"opened_at_local",
		"closed_at",
		"closed_at_local",
		"orders_count",
		"sales_amount",
		"opening_float_amount",
		"expected_cash_amount",
		"cash_drawer_amount",
		"cash_variance_amount",
		"changed_after_close",
		"status",
		"device_code",
	),
	...personal("cashier_name"),
];

export const DAILY_SUMMARY_COLUMNS: readonly ExportColumn[] = plain(
	"business_date",
	"scope",
	"store_name",
	...PERIOD_TOTAL_COLUMNS,
	"holiday_kind",
	"checked_days",
	"matched_days",
);

export const COLUMNS: Readonly<Record<ExportTableId, readonly ExportColumn[]>> =
	{
		invoices: INVOICE_COLUMNS,
		invoice_lines: LINE_COLUMNS,
		invoice_payments: PAYMENT_COLUMNS,
		shifts: SHIFT_COLUMNS,
		daily_summary: DAILY_SUMMARY_COLUMNS,
	};

export function columnsFor(
	table: ExportTableId,
	includePersonal: boolean,
): string[] {
	return COLUMNS[table]
		.filter((column) => includePersonal || !column.personal)
		.map((column) => column.key);
}

export function personalColumnsOf(table: ExportTableId): string[] {
	return COLUMNS[table]
		.filter((column) => column.personal)
		.map((column) => column.key);
}

export type NumericValue = number | string;

export interface InvoiceRecord {
	readonly id: string;
	readonly external_id: string;
	readonly receipt_no: string | null;
	readonly business_date: string;
	readonly sold_at: string;
	readonly opened_at: string | null;
	readonly closed_at: string | null;
	readonly status: string;
	readonly table_name: string | null;
	readonly area_name: string | null;
	readonly sale_type: string | null;
	readonly source_name: string | null;
	readonly shift_external_id: string | null;
	readonly device_code: string | null;
	readonly guest_count: number | null;
	readonly gross_amount: NumericValue;
	readonly item_discount_amount: NumericValue;
	readonly bill_discount_amount: NumericValue;
	readonly extra_discount_amount: NumericValue;
	readonly bill_discount_name: string | null;
	readonly voucher_name: string | null;
	readonly voucher_amount: NumericValue;
	readonly partner_marketing_amount: NumericValue;
	readonly service_charge_amount: NumericValue;
	readonly shipping_fee_amount: NumericValue;
	readonly vat_amount: NumericValue;
	readonly net_amount: NumericValue;
	readonly paid_amount: NumericValue;
	readonly primary_payment_method_name: string | null;
	readonly customer_phone?: string | null | undefined;
	readonly customer_name?: string | null | undefined;
	readonly employee_name?: string | null | undefined;
	readonly voucher_code?: string | null | undefined;
}

export interface LineRecord {
	readonly invoice_id: string;
	readonly external_id: string;
	readonly parent_line_external_id: string | null;
	readonly line_kind: string;
	readonly item_external_id: string | null;
	readonly item_name: string;
	readonly base_name: string | null;
	readonly size_label: string | null;
	readonly item_type_name: string | null;
	readonly item_class_name: string | null;
	readonly unit_name: string | null;
	readonly package_external_id: string | null;
	readonly quantity: NumericValue;
	readonly list_unit_price: NumericValue | null;
	readonly unit_price: NumericValue;
	readonly gross_amount: NumericValue;
	readonly discount_amount: NumericValue;
	readonly net_amount: NumericValue;
	readonly promotion_name: string | null;
	readonly note?: string | null | undefined;
	readonly invoices: {
		readonly external_id: string;
		readonly business_date: string;
	};
}

export interface PaymentRecord {
	readonly invoice_id: string;
	readonly business_date: string;
	readonly sequence_no: number;
	readonly payment_method_external_id: string | null;
	readonly payment_method_name: string | null;
	readonly amount: NumericValue;
	readonly fee_amount: NumericValue;
	readonly reference_no?: string | null | undefined;
	readonly partner_transaction_id?: string | null | undefined;
	readonly invoices: { readonly external_id: string };
}

export interface ShiftRecord {
	readonly id: string;
	readonly external_id: string;
	readonly name?: string | null | undefined;
	readonly opened_at: string;
	readonly closed_at: string | null;
	readonly orders_count: number;
	readonly sales_amount: NumericValue;
	readonly opening_float_amount: NumericValue | null;
	readonly expected_cash_amount: NumericValue | null;
	readonly cash_drawer_amount: NumericValue | null;
	readonly cash_variance_amount: NumericValue | null;
	readonly changed_after_close: boolean;
	readonly status: string | null;
	readonly device_code: string | null;
	readonly cashier_name?: string | null | undefined;
}

export interface StoreTableRecords {
	readonly invoices: InvoiceRecord;
	readonly invoice_lines: LineRecord;
	readonly invoice_payments: PaymentRecord;
	readonly shifts: ShiftRecord;
}

export type RecordOf<T extends StoreTableId> = StoreTableRecords[T];

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export function localDateTime(
	timestamp: string | null,
	timeZone: string,
): string | null {
	if (timestamp === null) return null;
	const instant = new Date(timestamp);
	if (Number.isNaN(instant.getTime())) return null;
	const clock = wallClockIn(instant, timeZone);
	return `${pad(clock.year, 4)}-${pad(clock.month)}-${pad(clock.day)} ${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`;
}

export function shiftBusinessDate(
	openedAt: string,
	store: Pick<ExportStore, "timeZone" | "businessDayStartMinutes">,
): string {
	return businessDate(
		new Date(openedAt),
		store.timeZone,
		store.businessDayStartMinutes,
	);
}

function numberCell(value: NumericValue | null | undefined): number | null {
	if (value === null || value === undefined) return null;
	return typeof value === "number" ? value : Number(value);
}

function textCell(value: string | null | undefined): string | null {
	return value === undefined ? null : value;
}

export function invoiceRow(
	record: InvoiceRecord,
	store: ExportStore,
): ExportRow {
	return {
		store_name: store.name,
		id: record.id,
		external_id: record.external_id,
		receipt_no: record.receipt_no,
		business_date: record.business_date,
		sold_at: record.sold_at,
		sold_at_local: localDateTime(record.sold_at, store.timeZone),
		opened_at: record.opened_at,
		closed_at: record.closed_at,
		status: record.status,
		table_name: record.table_name,
		area_name: record.area_name,
		sale_type: record.sale_type,
		source_name: record.source_name,
		shift_external_id: record.shift_external_id,
		device_code: record.device_code,
		guest_count: record.guest_count,
		gross_amount: numberCell(record.gross_amount),
		item_discount_amount: numberCell(record.item_discount_amount),
		bill_discount_amount: numberCell(record.bill_discount_amount),
		extra_discount_amount: numberCell(record.extra_discount_amount),
		bill_discount_name: record.bill_discount_name,
		voucher_name: record.voucher_name,
		voucher_amount: numberCell(record.voucher_amount),
		partner_marketing_amount: numberCell(record.partner_marketing_amount),
		service_charge_amount: numberCell(record.service_charge_amount),
		shipping_fee_amount: numberCell(record.shipping_fee_amount),
		vat_amount: numberCell(record.vat_amount),
		net_amount: numberCell(record.net_amount),
		paid_amount: numberCell(record.paid_amount),
		primary_payment_method_name: record.primary_payment_method_name,
		customer_phone: textCell(record.customer_phone),
		customer_name: textCell(record.customer_name),
		employee_name: textCell(record.employee_name),
		voucher_code: textCell(record.voucher_code),
	};
}

export function lineRow(record: LineRecord, store: ExportStore): ExportRow {
	return {
		store_name: store.name,
		invoice_id: record.invoice_id,
		invoice_external_id: record.invoices.external_id,
		business_date: record.invoices.business_date,
		external_id: record.external_id,
		parent_line_external_id: record.parent_line_external_id,
		line_kind: record.line_kind,
		item_external_id: record.item_external_id,
		item_name: record.item_name,
		base_name: record.base_name,
		size_label: record.size_label,
		item_type_name: record.item_type_name,
		item_class_name: record.item_class_name,
		unit_name: record.unit_name,
		package_external_id: record.package_external_id,
		quantity: numberCell(record.quantity),
		list_unit_price: numberCell(record.list_unit_price),
		unit_price: numberCell(record.unit_price),
		gross_amount: numberCell(record.gross_amount),
		discount_amount: numberCell(record.discount_amount),
		net_amount: numberCell(record.net_amount),
		promotion_name: record.promotion_name,
		note: textCell(record.note),
	};
}

export function paymentRow(
	record: PaymentRecord,
	store: ExportStore,
): ExportRow {
	return {
		store_name: store.name,
		invoice_id: record.invoice_id,
		invoice_external_id: record.invoices.external_id,
		business_date: record.business_date,
		sequence_no: record.sequence_no,
		payment_method_external_id: record.payment_method_external_id,
		payment_method_name: record.payment_method_name,
		amount: numberCell(record.amount),
		fee_amount: numberCell(record.fee_amount),
		reference_no: textCell(record.reference_no),
		partner_transaction_id: textCell(record.partner_transaction_id),
	};
}

export function shiftRow(record: ShiftRecord, store: ExportStore): ExportRow {
	return {
		store_name: store.name,
		id: record.id,
		external_id: record.external_id,
		name: textCell(record.name),
		business_date: shiftBusinessDate(record.opened_at, store),
		opened_at: record.opened_at,
		opened_at_local: localDateTime(record.opened_at, store.timeZone),
		closed_at: record.closed_at,
		closed_at_local: localDateTime(record.closed_at, store.timeZone),
		orders_count: record.orders_count,
		sales_amount: numberCell(record.sales_amount),
		opening_float_amount: numberCell(record.opening_float_amount),
		expected_cash_amount: numberCell(record.expected_cash_amount),
		cash_drawer_amount: numberCell(record.cash_drawer_amount),
		cash_variance_amount: numberCell(record.cash_variance_amount),
		changed_after_close: record.changed_after_close,
		status: record.status,
		device_code: record.device_code,
		cashier_name: textCell(record.cashier_name),
	};
}

export function storeTableRow<T extends StoreTableId>(
	table: T,
	record: RecordOf<T>,
	store: ExportStore,
): ExportRow {
	switch (table) {
		case "invoices":
			return invoiceRow(record as InvoiceRecord, store);
		case "invoice_lines":
			return lineRow(record as LineRecord, store);
		case "invoice_payments":
			return paymentRow(record as PaymentRecord, store);
		default:
			return shiftRow(record as ShiftRecord, store);
	}
}

export function withColumns(
	row: ExportRow,
	columns: readonly string[],
): ExportRow {
	const picked: Record<string, ExportCell> = {};
	for (const column of columns) picked[column] = row[column] ?? null;
	return picked;
}
