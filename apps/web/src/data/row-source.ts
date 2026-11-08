import type { IsoDate } from "../lib/business-dates";

export type PaymentKind =
	| "cash"
	| "card"
	| "bank_transfer"
	| "ewallet"
	| "voucher"
	| "other";

export const paymentKinds: readonly PaymentKind[] = [
	"cash",
	"card",
	"bank_transfer",
	"ewallet",
	"voucher",
	"other",
];

export type InvoiceStatus = "completed" | "edited" | "voided";

export type LineKind = "item" | "modifier" | "service" | "package" | "other";

export interface TenantRow {
	id: string;
	name: string;
	currencyCode: string;
	timeZone: string;
	countryCode: string;
}

export interface StoreRow {
	id: string;
	tenantId: string;
	name: string;
	code: string | null;
	timeZone: string;
	businessDayStartMinutes: number;
	posAccountId: string;
}

export interface InvoiceRow {
	id: string;
	storeId: string;
	businessDate: IsoDate;
	soldAt: string;
	netAmount: number;
	status: InvoiceStatus;
}

export interface InvoiceLineRow {
	invoiceId: string;
	storeId: string;
	lineKind: LineKind;
	itemExternalId: string | null;
	itemName: string;
	quantity: number;
	netAmount: number;
}

export interface PaymentRow {
	invoiceId: string;
	storeId: string;
	businessDate: IsoDate;
	methodExternalId: string | null;
	methodName: string | null;
	amount: number;
}

export interface PaymentMethodRow {
	posAccountId: string;
	externalId: string;
	name: string;
	kind: PaymentKind;
}

export interface SyncCheckRow {
	storeId: string;
	businessDate: IsoDate;
	isMatched: boolean;
}

export type Freshness =
	| { kind: "sample" }
	| { kind: "never" }
	| { kind: "synced"; finishedAt: Date };

export type VerificationRows =
	| { kind: "sample" }
	| { kind: "checked"; checks: SyncCheckRow[] };

export interface StoreDates {
	storeIds: readonly string[];
	dates: readonly IsoDate[];
}

export interface RowSource {
	readonly kind: "supabase" | "demo";
	tenants(): Promise<TenantRow[]>;
	stores(tenantId: string): Promise<StoreRow[]>;
	paymentMethods(tenantId: string): Promise<PaymentMethodRow[]>;
	excludedDates(
		tenant: TenantRow,
		dates: readonly IsoDate[],
	): Promise<IsoDate[]>;
	invoices(scope: StoreDates): Promise<InvoiceRow[]>;
	invoiceLines(scope: StoreDates): Promise<InvoiceLineRow[]>;
	payments(scope: StoreDates): Promise<PaymentRow[]>;
	freshness(tenantId: string): Promise<Freshness>;
	verification(scope: StoreDates): Promise<VerificationRows>;
}
