import type { DateRange } from "../repository.js";
import type {
	AccountRecord,
	InvoiceEventRow,
	InvoiceLineRow,
	InvoicePaymentRow,
	InvoiceRow,
	JsonValue,
	RunFinish,
	RunStart,
	ShiftRow,
	StoreRecord,
	SyncCheckRow,
	TokenRecord,
} from "../rows.js";

export interface MemoryTenant {
	id: string;
	slug: string;
	currency_code: string;
}

export interface StoredInvoice extends InvoiceRow {
	id: string;
	synced_at: string;
}

export interface StoredLine extends InvoiceLineRow {
	id: string;
	invoice_id: string;
}

export interface StoredPayment extends InvoicePaymentRow {
	id: string;
	invoice_id: string;
}

export interface StoredEvent extends InvoiceEventRow {
	id: string;
	invoice_id: string | null;
	created_at: string;
}

export interface StoredShift extends ShiftRow {
	id: string;
}

export interface StoredCheck extends SyncCheckRow {
	id: string;
	checked_at: string;
}

export interface StoredRun extends RunStart {
	id: string;
	status: "running" | RunFinish["status"];
	finished_at: string | null;
	rows_upserted: RunFinish["rows_upserted"];
	error_message: string | null;
}

export interface StoredAccount {
	id: string;
	tenant_id: string;
	connector: string;
	account_key: string;
	display_name: string;
	status: AccountRecord["status"];
	last_synced_at: string | null;
}

export interface StoredStore extends StoreRecord {
	raw: JsonValue | null;
	first_seen_at: string;
	last_seen_at: string;
}

export interface StoredCatalogRow {
	id: string;
	tenant_id: string;
	pos_account_id: string;
	external_id: string;
	active: boolean;
	first_seen_at: string;
	last_seen_at: string;
	values: Record<string, JsonValue>;
}

export interface MemoryTables {
	tenants: MemoryTenant[];
	accounts: StoredAccount[];
	tokens: Map<string, TokenRecord>;
	stores: StoredStore[];
	catalog: Map<string, StoredCatalogRow[]>;
	invoices: StoredInvoice[];
	lines: StoredLine[];
	payments: StoredPayment[];
	events: StoredEvent[];
	shifts: StoredShift[];
	checks: StoredCheck[];
	runs: StoredRun[];
}

export const MEMORY_CATALOG_TABLES = [
	"item_types",
	"item_classes",
	"units",
	"items",
	"packages",
	"customizations",
	"sources",
	"payment_methods",
	"promotions",
	"devices",
] as const;

export function emptyTables(): MemoryTables {
	return {
		tenants: [],
		accounts: [],
		tokens: new Map(),
		stores: [],
		catalog: new Map(MEMORY_CATALOG_TABLES.map((table) => [table, []])),
		invoices: [],
		lines: [],
		payments: [],
		events: [],
		shifts: [],
		checks: [],
		runs: [],
	};
}

export function byText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function inRange(date: string, range: DateRange): boolean {
	return date >= range.from && date <= range.to;
}

export class MemoryState {
	tables: MemoryTables = emptyTables();
	private sequence = 0;
	private readonly now: () => Date;

	constructor(now: () => Date) {
		this.now = now;
	}

	nextId(prefix: string): string {
		this.sequence += 1;
		return `${prefix}-${String(this.sequence).padStart(6, "0")}`;
	}

	timestamp(): string {
		return this.now().toISOString();
	}
}
