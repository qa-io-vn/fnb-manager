/**
 * The provider seam of e-invoices (ADR-063, ADR-069). The database owns the documents (public.e_invoices): when an order
 * is paid it queues a sale invoice, when a customer asks for a company invoice it queues the replacement, when money
 * goes back it queues a correction, and it fixes every amount when the job takes a document. An adapter only turns one
 * document into the provider's call and reads the provider's answer back. Nothing here decides what is owed.
 *
 * The invoices are of the kind "khởi tạo từ máy tính tiền" (made from a cash register): the provider needs no digital
 * signature of ours and passes the data to the tax authority. Every call names our document id, which the providers
 * keep as their own idempotency key (EasyInvoice Ikey, MISA RefID, Viettel transactionUuid, VNPT fkey, BKAV
 * PartnerInvoiceID), so an attempt after a lost answer first asks for the document by that id and never makes it twice.
 */

export type EInvoiceMode = "sandbox" | "live";
/** A row's mode: off rows are never run, but the type reads what the database answers. */
export type ConfigMode = EInvoiceMode | "off";

/** Template 1 is a VAT invoice, template 2 a sales invoice (a household business or a seller outside VAT). */
export type InvoiceTemplate = "1" | "2";
export type VatRate = "none" | "0" | "5" | "8" | "10";

/** The seller's public settings of a provider row. */
export interface SellerSettings {
	readonly sellerTaxCode: string;
	readonly template: InvoiceTemplate;
	/** six characters: C or K, the year, M (made from a cash register), two characters of the seller */
	readonly series: string;
	readonly vatRate: VatRate;
}

/** The buyer of a company invoice, as the request holds it (checked by the database and again here). */
export interface Buyer {
	readonly taxCode: string;
	readonly companyName: string;
	readonly address: string;
	readonly email: string;
}

/** One line of a sale or company invoice: prices include VAT where there is one, whole đồng. */
export interface InvoiceLine {
	readonly name: string;
	readonly quantity: number;
	readonly unitPrice: number;
	readonly amount: number;
}

export type PaymentMethod = "cash" | "card" | "zalo_checkout" | "vietqr";

/** A document the provider already holds, which a replacement, an adjustment or a cancellation acts on. */
export interface OriginalInvoice {
	readonly invoiceId: string;
	readonly providerRef: string;
	readonly invoiceNo: string | null;
	readonly series: string | null;
	readonly issuedAt: string;
	/** what the provider holds for it now (its total and the corrections already made) */
	readonly amount: number;
}

export interface IssueRequest {
	/** our document id: the provider's idempotency key */
	readonly invoiceId: string;
	/** the moment of the sale: the payment */
	readonly soldAt: string;
	/** whole đồng, the sum of the lines */
	readonly amount: number;
	readonly seller: SellerSettings;
	/** null for the sale invoice of a cash register, the company for a company invoice */
	readonly buyer: Buyer | null;
	readonly lines: readonly InvoiceLine[];
	readonly paymentMethods: readonly PaymentMethod[];
	/** the order's number as staff call it, such as #007, for the invoice's note */
	readonly orderLabel: string | null;
	readonly storeName: string;
}

export interface ReplaceRequest extends IssueRequest {
	readonly buyer: Buyer;
	readonly original: OriginalInvoice;
}

export interface AdjustRequest {
	readonly invoiceId: string;
	readonly original: OriginalInvoice;
	/** the change in whole đồng: negative for a refund */
	readonly amount: number;
	readonly seller: SellerSettings;
	readonly reason: string;
	readonly at: string;
}

export interface CancelRequest {
	readonly invoiceId: string;
	readonly original: OriginalInvoice;
	readonly seller: SellerSettings;
	readonly reason: string;
	readonly at: string;
}

/** What a provider made: a sale or company invoice, a replacement, an adjustment, a cancellation. */
export type InvoiceOperation = "issue" | "replace" | "adjust" | "cancel";

/** A document the provider made, as the job records it. */
export interface IssuedInvoice {
	readonly operation: InvoiceOperation;
	readonly providerRef: string;
	readonly invoiceNo: string | null;
	readonly series: string | null;
	readonly lookupCode: string | null;
	readonly lookupUrl: string | null;
	/** the tax authority's code of an invoice made from a cash register, when the provider gives it */
	readonly taxAuthorityCode: string | null;
	/** the document's amount as the provider holds it (negative for a correction) */
	readonly amount: number;
	readonly issuedAt: string;
	/** whether the provider emailed the buyer itself */
	readonly emailed: boolean;
}

export interface InvoiceLookup {
	readonly lookupCode: string;
	readonly lookupUrl: string;
}

export interface EInvoiceProvider {
	readonly adapter: string;
	readonly mode: EInvoiceMode;
	/** makes the sale invoice of a paid order (or a company invoice with a buyer) under our id */
	issue(request: IssueRequest): Promise<IssuedInvoice>;
	/** the document made under our id, or null when the provider never made it */
	query(invoiceId: string): Promise<IssuedInvoice | null>;
	/** a company invoice that replaces an issued one (the original is no longer valid at the provider) */
	replace(request: ReplaceRequest): Promise<IssuedInvoice>;
	/** an adjustment of an issued invoice by an amount */
	adjust(request: AdjustRequest): Promise<IssuedInvoice>;
	/** a cancellation, or "unsupported" when the provider or the law cancels no valid invoice (the job adjusts to zero) */
	cancel(request: CancelRequest): Promise<IssuedInvoice | "unsupported">;
	/** the lookup code and address of an issued document */
	lookup(providerRef: string): Promise<InvoiceLookup | null>;
}

/**
 * What went wrong, by class only: never the provider's text, which may repeat the buyer's data. The first six are
 * retried with back-off by the database; the last three need a person.
 */
export type EInvoiceErrorClass =
	| "timeout"
	| "unavailable"
	| "rate_limited"
	| "rejected_auth"
	| "not_configured"
	| "unknown"
	| "rejected_data"
	| "rejected_duplicate"
	| "unsupported";

export const ERROR_CLASSES: readonly EInvoiceErrorClass[] = [
	"timeout",
	"unavailable",
	"rate_limited",
	"rejected_auth",
	"not_configured",
	"unknown",
	"rejected_data",
	"rejected_duplicate",
	"unsupported",
];

export const RETRYABLE: ReadonlySet<EInvoiceErrorClass> = new Set([
	"timeout",
	"unavailable",
	"rate_limited",
	"rejected_auth",
	"not_configured",
	"unknown",
]);

/** The provider could not be reached or did not answer in time: it may or may not have made the document. */
export class EInvoiceUnavailableError extends Error {
	readonly errorClass: "timeout" | "unavailable" | "rate_limited";

	constructor(errorClass: "timeout" | "unavailable" | "rate_limited") {
		super(`the e-invoice provider was ${errorClass.replace("_", " ")}`);
		this.name = "EInvoiceUnavailableError";
		this.errorClass = errorClass;
	}
}

/** The provider (or our own check before the call) refused the document. */
export class EInvoiceRefusedError extends Error {
	readonly errorClass:
		| "rejected_data"
		| "rejected_auth"
		| "rejected_duplicate"
		| "unsupported";

	constructor(
		errorClass:
			| "rejected_data"
			| "rejected_auth"
			| "rejected_duplicate"
			| "unsupported",
		message = "the e-invoice provider refused the document",
	) {
		super(message);
		this.name = "EInvoiceRefusedError";
		this.errorClass = errorClass;
	}
}

/** A provider row the function cannot run (an unknown adapter, a mock where mocks are not allowed, a missing key). */
export class EInvoiceConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EInvoiceConfigError";
	}
}

/** The class of anything an adapter threw; an unexpected error is unknown (retried), never its text. */
export function errorClassOf(error: unknown): EInvoiceErrorClass {
	if (
		error instanceof EInvoiceUnavailableError ||
		error instanceof EInvoiceRefusedError
	) {
		return error.errorClass;
	}
	if (error instanceof EInvoiceConfigError) {
		return "not_configured";
	}
	return "unknown";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
