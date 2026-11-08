import type {
	CatalogEntryRow,
	DeviceRow,
	InvoiceEventRow,
	InvoiceLineRow,
	InvoicePaymentRow,
	InvoiceRow,
	ItemRow,
	PackageRow,
	PaymentMethodRow,
	PromotionRow,
	ShiftRow,
	StoreUpsert,
	SyncCheckRow,
} from "../rows.js";

type Complete<T, K extends readonly (keyof T & string)[]> = [
	Exclude<keyof T, K[number]>,
] extends [never]
	? K
	: never;

function columnsOf<T>() {
	return <const K extends readonly (keyof T & string)[]>(
		columns: K & Complete<T, K>,
	): K => columns;
}

export const INVOICE_COLUMNS = columnsOf<InvoiceRow>()([
	"tenant_id",
	"store_id",
	"pos_account_id",
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
	"status",
	"raw",
]);

export const INVOICE_KEY_COLUMNS = ["tenant_id", "store_id", "external_id"];

export const LINE_COLUMNS = columnsOf<InvoiceLineRow>()([
	"tenant_id",
	"store_id",
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
	"raw",
]);

export const PAYMENT_COLUMNS = columnsOf<InvoicePaymentRow>()([
	"tenant_id",
	"store_id",
	"sequence_no",
	"business_date",
	"payment_method_external_id",
	"payment_method_name",
	"amount",
	"fee_amount",
	"reference_no",
	"partner_transaction_id",
	"raw",
]);

export const EVENT_COLUMNS = columnsOf<InvoiceEventRow>()([
	"tenant_id",
	"store_id",
	"invoice_external_id",
	"kind",
	"occurred_at",
	"amount",
	"reason",
	"source",
	"raw",
]);

export const SHIFT_COLUMNS = columnsOf<ShiftRow>()([
	"tenant_id",
	"store_id",
	"external_id",
	"name",
	"cashier_external_id",
	"cashier_name",
	"opened_at",
	"closed_at",
	"sales_amount",
	"orders_count",
	"cash_drawer_amount",
	"opening_float_amount",
	"expected_cash_amount",
	"changed_after_close",
	"status",
	"device_code",
	"raw",
]);

export const CHECK_COLUMNS = columnsOf<SyncCheckRow>()([
	"tenant_id",
	"store_id",
	"business_date",
	"source_invoice_count",
	"source_net_amount",
	"local_invoice_count",
	"local_net_amount",
	"is_matched",
]);

export const STORE_COLUMNS = columnsOf<StoreUpsert>()([
	"external_id",
	"name",
	"address",
	"timezone",
	"business_day_start_minutes",
	"opened_on",
	"raw",
]);

const ENTRY_COLUMNS = columnsOf<CatalogEntryRow>()([
	"external_id",
	"name",
	"raw",
]);

export const CATALOG_COLUMNS = {
	item_types: ENTRY_COLUMNS,
	item_classes: ENTRY_COLUMNS,
	units: ENTRY_COLUMNS,
	customizations: ENTRY_COLUMNS,
	sources: ENTRY_COLUMNS,
	items: columnsOf<ItemRow>()([
		"external_id",
		"name",
		"base_name",
		"size_label",
		"item_type_external_id",
		"item_class_external_id",
		"unit_external_id",
		"unit_name",
		"list_price",
		"takeaway_price",
		"cost_price",
		"is_modifier",
		"active",
		"raw",
	]),
	packages: columnsOf<PackageRow>()([
		"external_id",
		"name",
		"list_price",
		"raw",
	]),
	payment_methods: columnsOf<PaymentMethodRow>()([
		"external_id",
		"name",
		"kind",
		"raw",
	]),
	promotions: columnsOf<PromotionRow>()([
		"external_id",
		"name",
		"starts_at",
		"ends_at",
		"raw",
	]),
	devices: columnsOf<DeviceRow>()([
		"external_id",
		"code",
		"name",
		"store_external_id",
		"raw",
	]),
} as const;

export type CatalogTable = keyof typeof CATALOG_COLUMNS;

export const CATALOG_TABLES = Object.keys(
	CATALOG_COLUMNS,
).sort() as CatalogTable[];

export const DATE_COLUMNS: ReadonlySet<string> = new Set(["business_date"]);

export function selectList(alias: string, columns: readonly string[]): string {
	return columns
		.map((column) =>
			DATE_COLUMNS.has(column)
				? `${alias}.${column}::text as ${column}`
				: `${alias}.${column}`,
		)
		.join(", ");
}
