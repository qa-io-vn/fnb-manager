import type { AdjustmentKind, PaymentKind, SaleStatus } from "@fnb/core";

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type InvoiceStatus = SaleStatus;
export type DbLineKind = "item" | "modifier" | "service" | "package" | "other";
export type EventSource = "resync_diff" | "pos_report";
export type DbSyncKind =
	| "incremental"
	| "nightly"
	| "backfill"
	| "master_data"
	| "reconciliation";
export type RunStatus = "running" | "succeeded" | "partial" | "failed";
export type AccountStatus = "active" | "paused" | "error" | "auth_failed";

export type TableCounts = Record<string, number>;

export const INVOICE_DIGEST_COLUMNS = [
	"external_id",
	"receipt_no",
	"sold_at",
	"business_date",
	"opened_at",
	"closed_at",
	"table_name",
	"area_name",
	"sale_type",
	"source_external_id",
	"source_name",
	"employee_external_id",
	"employee_name",
	"shift_external_id",
	"device_code",
	"guest_count",
	"customer_phone",
	"customer_name",
	"gross_amount",
	"item_discount_amount",
	"bill_discount_amount",
	"extra_discount_amount",
	"bill_discount_name",
	"voucher_code",
	"voucher_name",
	"voucher_amount",
	"partner_marketing_amount",
	"service_charge_amount",
	"shipping_fee_amount",
	"vat_amount",
	"net_amount",
	"paid_amount",
	"primary_payment_method_external_id",
	"primary_payment_method_name",
] as const;

export const LINE_DIGEST_COLUMNS = [
	"external_id",
	"parent_line_external_id",
	"line_kind",
	"item_external_id",
	"item_name",
	"base_name",
	"size_label",
	"item_type_external_id",
	"item_type_name",
	"item_class_external_id",
	"item_class_name",
	"unit_external_id",
	"unit_name",
	"package_external_id",
	"quantity",
	"list_unit_price",
	"unit_price",
	"gross_amount",
	"discount_amount",
	"net_amount",
	"promotion_external_id",
	"promotion_name",
	"note",
] as const;

export const PAYMENT_DIGEST_COLUMNS = [
	"sequence_no",
	"payment_method_external_id",
	"payment_method_name",
	"amount",
	"fee_amount",
	"reference_no",
	"partner_transaction_id",
] as const;

export type InvoiceDigestColumn = (typeof INVOICE_DIGEST_COLUMNS)[number];
export type LineDigestColumn = (typeof LINE_DIGEST_COLUMNS)[number];
export type PaymentDigestColumn = (typeof PAYMENT_DIGEST_COLUMNS)[number];

export interface InvoiceRow {
	tenant_id: string;
	store_id: string;
	pos_account_id: string;
	external_id: string;
	receipt_no: string | null;
	sold_at: string;
	business_date: string;
	opened_at: string | null;
	closed_at: string | null;
	table_name: string | null;
	area_name: string | null;
	sale_type: string | null;
	source_external_id: string | null;
	source_name: string | null;
	employee_external_id: string | null;
	employee_name: string | null;
	shift_external_id: string | null;
	device_code: string | null;
	guest_count: number | null;
	customer_phone: string | null;
	customer_name: string | null;
	gross_amount: string;
	item_discount_amount: string;
	bill_discount_amount: string;
	extra_discount_amount: string;
	bill_discount_name: string | null;
	voucher_code: string | null;
	voucher_name: string | null;
	voucher_amount: string;
	partner_marketing_amount: string;
	service_charge_amount: string;
	shipping_fee_amount: string;
	vat_amount: string;
	net_amount: string;
	paid_amount: string;
	primary_payment_method_external_id: string | null;
	primary_payment_method_name: string | null;
	status: InvoiceStatus;
	raw: JsonValue | null;
}

export interface InvoiceLineRow {
	tenant_id: string;
	store_id: string;
	external_id: string;
	parent_line_external_id: string | null;
	line_kind: DbLineKind;
	item_external_id: string | null;
	item_name: string;
	base_name: string | null;
	size_label: string | null;
	item_type_external_id: string | null;
	item_type_name: string | null;
	item_class_external_id: string | null;
	item_class_name: string | null;
	unit_external_id: string | null;
	unit_name: string | null;
	package_external_id: string | null;
	quantity: string;
	list_unit_price: string | null;
	unit_price: string;
	gross_amount: string;
	discount_amount: string;
	net_amount: string;
	promotion_external_id: string | null;
	promotion_name: string | null;
	note: string | null;
	raw: JsonValue | null;
}

export interface InvoicePaymentRow {
	tenant_id: string;
	store_id: string;
	sequence_no: number;
	business_date: string;
	payment_method_external_id: string | null;
	payment_method_name: string | null;
	amount: string;
	fee_amount: string;
	reference_no: string | null;
	partner_transaction_id: string | null;
	raw: JsonValue | null;
}

export interface SaleWrite {
	invoice: InvoiceRow;
	lines: InvoiceLineRow[];
	payments: InvoicePaymentRow[];
}

export interface InvoiceEventRow {
	tenant_id: string;
	store_id: string;
	invoice_external_id: string;
	kind: AdjustmentKind;
	occurred_at: string;
	amount: string | null;
	reason: string | null;
	source: EventSource;
	raw: JsonValue | null;
}

export interface StatusChange {
	external_id: string;
	status: InvoiceStatus;
	from: InvoiceStatus[];
}

export interface StoreDayWrite {
	tenant_id: string;
	store_id: string;
	business_date: string;
	sales: SaleWrite[];
	status_changes: StatusChange[];
	events: InvoiceEventRow[];
}

export interface AdjustmentWrite {
	tenant_id: string;
	store_id: string;
	events: InvoiceEventRow[];
	status_changes: StatusChange[];
}

export interface ExistingInvoice {
	external_id: string;
	business_date: string;
	sold_at: string;
	status: InvoiceStatus;
	net_amount: string;
	digest: string;
	line_set: string;
}

export interface ShiftPaymentTotal {
	shift_external_id: string;
	payment_method_external_id: string | null;
	amount: string;
}

export interface ExistingEvent {
	invoice_external_id: string;
	kind: AdjustmentKind;
	source: string;
	occurred_at: string;
}

export interface StoreWindowState {
	invoices: ExistingInvoice[];
	events: ExistingEvent[];
}

export interface ShiftRow {
	tenant_id: string;
	store_id: string;
	external_id: string;
	name: string | null;
	cashier_external_id: string | null;
	cashier_name: string | null;
	opened_at: string;
	closed_at: string | null;
	sales_amount: string;
	orders_count: number;
	cash_drawer_amount: string | null;
	opening_float_amount: string | null;
	expected_cash_amount: string | null;
	changed_after_close: boolean;
	status: string | null;
	device_code: string | null;
	raw: JsonValue | null;
}

export interface SyncCheckRow {
	tenant_id: string;
	store_id: string;
	business_date: string;
	source_invoice_count: number;
	source_net_amount: string;
	local_invoice_count: number;
	local_net_amount: string;
	is_matched: boolean;
}

export interface LocalDayTotal {
	business_date: string;
	invoice_count: number;
	net_amount: string;
}

export interface AccountRecord {
	id: string;
	tenant_id: string;
	tenant_slug: string;
	tenant_currency: string;
	connector: string;
	account_key: string;
	display_name: string;
	status: AccountStatus;
	last_synced_at: string | null;
}

export interface AccountUpsert {
	tenant_id: string;
	connector: string;
	account_key: string;
	display_name: string;
}

export interface StoreRecord {
	id: string;
	tenant_id: string;
	pos_account_id: string;
	external_id: string;
	code: string | null;
	name: string;
	address: string | null;
	timezone: string;
	business_day_start_minutes: number;
	opened_on: string | null;
	active: boolean;
}

export interface StoreUpsert {
	external_id: string;
	name: string;
	address: string | null;
	timezone: string;
	business_day_start_minutes: number;
	opened_on: string | null;
	raw: JsonValue | null;
}

export interface CatalogEntryRow {
	external_id: string;
	name: string;
	raw: JsonValue | null;
}

export interface ItemRow {
	external_id: string;
	name: string;
	base_name: string | null;
	size_label: string | null;
	item_type_external_id: string | null;
	item_class_external_id: string | null;
	unit_external_id: string | null;
	unit_name: string | null;
	list_price: string | null;
	takeaway_price: string | null;
	cost_price: string | null;
	is_modifier: boolean;
	active: boolean;
	raw: JsonValue | null;
}

export interface PackageRow {
	external_id: string;
	name: string;
	list_price: string | null;
	raw: JsonValue | null;
}

export interface PaymentMethodRow {
	external_id: string;
	name: string;
	kind: PaymentKind;
	raw: JsonValue | null;
}

export interface PromotionRow {
	external_id: string;
	name: string;
	starts_at: string | null;
	ends_at: string | null;
	raw: JsonValue | null;
}

export interface DeviceRow {
	external_id: string;
	code: string | null;
	name: string | null;
	store_external_id: string | null;
	raw: JsonValue | null;
}

export interface CatalogWrite {
	tenant_id: string;
	pos_account_id: string;
	item_types: CatalogEntryRow[] | null;
	item_classes: CatalogEntryRow[] | null;
	units: CatalogEntryRow[] | null;
	items: ItemRow[] | null;
	packages: PackageRow[] | null;
	customizations: CatalogEntryRow[] | null;
	sources: CatalogEntryRow[] | null;
	payment_methods: PaymentMethodRow[] | null;
	promotions: PromotionRow[] | null;
	devices: DeviceRow[] | null;
}

export interface TokenRecord {
	token: string;
	expires_at: string;
}

export interface RunStart {
	tenant_id: string;
	pos_account_id: string;
	store_id?: string | null;
	store_ids?: string[] | null;
	kind: DbSyncKind;
	range_start: string | null;
	range_end: string | null;
	started_at: string;
	triggered_by: string | null;
}

export interface RunFinish {
	status: Exclude<RunStatus, "running">;
	finished_at: string;
	rows_upserted: JsonObject;
	error_message: string | null;
}

export interface StoreContext {
	account: AccountRecord;
	store: StoreRecord;
}

export type RefreshResult =
	| { available: false }
	| { available: true; rows: number };
