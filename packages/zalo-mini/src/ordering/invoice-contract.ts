// The wire contract of e-invoices and company invoices for the apps (docs/api.md 3.30; native-till.md 17; ADR-069,
// ADR-070): the customer's company invoice (C18) with the saved companies, the order's e-invoice as the counter's pill
// shows it (Q01), and the checks a company passes before it is sent. The database checks a company again whatever a
// screen did and stays the authority; the client's checks below mirror it so a screen can say what is wrong before a
// call. Snake case is the wire; the readers return camel case and refuse anything malformed. A buyer's tax code, name,
// address and email are never logged, and nothing here writes them anywhere but the answer.

export const INVOICE_FUNCTIONS = {
	status: "customer_invoice_status",
	request: "customer_request_invoice",
	savedCompanies: "customer_saved_companies",
	deleteSavedCompany: "customer_delete_saved_company",
} as const;

/** The longest company name and address an invoice takes (app.einvoice_text_valid). */
export const COMPANY_NAME_MAX = 200;
export const COMPANY_ADDRESS_MAX = 300;
/** The longest email address (app.einvoice_email_valid): 254 characters, a local part of 64. */
export const COMPANY_EMAIL_MAX = 254;
export const COMPANY_EMAIL_LOCAL_MAX = 64;
/** At most this many saved companies per login (customer_request_invoice keeps no more). */
export const SAVED_COMPANIES_MAX = 10;

export const COMPANY_FIELDS = [
	"tax_code",
	"company_name",
	"address",
	"email",
] as const;
export type CompanyField = (typeof COMPANY_FIELDS)[number];

/** What a field holds wrong, for the words under it; the server only answers which fields are wrong. */
export type CompanyProblem =
	| { readonly field: "tax_code"; readonly kind: "empty" }
	/** only digits, but neither 10 nor 13 of them */
	| {
			readonly field: "tax_code";
			readonly kind: "digits";
			readonly count: number;
	  }
	/** a letter, a space inside, or another character */
	| { readonly field: "tax_code"; readonly kind: "characters" }
	/** digits and a hyphen, but not 10 digits, a hyphen and 3 */
	| { readonly field: "tax_code"; readonly kind: "format" }
	| {
			readonly field: "company_name" | "address";
			readonly kind: "empty" | "too_long" | "line" | "markup";
			readonly max: number;
	  }
	| { readonly field: "email"; readonly kind: "empty" | "too_long" | "format" };

/** A company as a screen holds it (what was typed). */
export interface CompanyInput {
	readonly taxCode: string;
	readonly companyName: string;
	readonly address: string;
	readonly email: string;
}

/** A company that passed the checks: the tax code as invoices print it, every value trimmed. */
export interface Company {
	readonly taxCode: string;
	readonly companyName: string;
	readonly address: string;
	readonly email: string;
}

export interface CompanyCheck {
	/** the first problem of each field in error, in the fields' order */
	readonly problems: readonly CompanyProblem[];
	/** the clean company when nothing is wrong */
	readonly company: Company | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// a control character (C0, DEL, C1) or a line or paragraph separator: an invoice field is one line
// biome-ignore lint/suspicious/noControlCharactersInRegex: the check is exactly for control characters
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const MARKUP = /[<>{}]/;
const EMAIL =
	/^[A-Za-z0-9_%+-]+(\.[A-Za-z0-9_%+-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

/** The spaces around a value go (only spaces, as the database's btrim(value, ' ')); nothing inside changes. */
export function trimSpaces(value: string): string {
	return value.replace(/^ +| +$/g, "");
}

function length(value: string): number {
	return [...value].length;
}

/**
 * A Vietnamese tax code as invoices print it, or null (app.einvoice_tax_code): 10 digits, or 10 digits, a hyphen and
 * 3 (a branch), after trimming the spaces around it; 13 bare digits gain their hyphen.
 */
export function normalizeTaxCode(value: string): string | null {
	const trimmed = trimSpaces(value);
	if (/^[0-9]{13}$/.test(trimmed))
		return `${trimmed.slice(0, 10)}-${trimmed.slice(10)}`;
	return /^[0-9]{10}(-[0-9]{3})?$/.test(trimmed) ? trimmed : null;
}

export function taxCodeProblem(value: string): CompanyProblem | null {
	if (normalizeTaxCode(value) !== null) return null;
	const trimmed = trimSpaces(value);
	if (trimmed === "") return { field: "tax_code", kind: "empty" };
	if (/^[0-9]+$/.test(trimmed))
		return { field: "tax_code", kind: "digits", count: trimmed.length };
	if (/^[0-9-]+$/.test(trimmed)) return { field: "tax_code", kind: "format" };
	return { field: "tax_code", kind: "characters" };
}

/**
 * Whether a company name or an address can go on an invoice (app.einvoice_text_valid after the spaces around it are
 * trimmed): 1 to max characters, Vietnamese letters included, on one line, without control characters and without
 * < > { } (refused, never escaped).
 */
export function companyTextProblem(
	field: "company_name" | "address",
	value: string,
): CompanyProblem | null {
	const max = field === "company_name" ? COMPANY_NAME_MAX : COMPANY_ADDRESS_MAX;
	const trimmed = trimSpaces(value);
	if (CONTROL.test(trimmed)) return { field, kind: "line", max };
	if (!/\S/u.test(trimmed)) return { field, kind: "empty", max };
	if (MARKUP.test(trimmed)) return { field, kind: "markup", max };
	if (length(trimmed) > max) return { field, kind: "too_long", max };
	return null;
}

/** Whether an address can receive the company invoice (app.einvoice_email_valid after trimming the spaces around). */
export function emailProblem(value: string): CompanyProblem | null {
	const trimmed = trimSpaces(value);
	if (trimmed === "") return { field: "email", kind: "empty" };
	if (
		length(trimmed) > COMPANY_EMAIL_MAX ||
		length(trimmed.split("@")[0] ?? "") > COMPANY_EMAIL_LOCAL_MAX
	)
		return { field: "email", kind: "too_long" };
	return EMAIL.test(trimmed) ? null : { field: "email", kind: "format" };
}

/** Every field checked as the database checks it; the clean company when nothing is wrong. */
export function checkCompany(input: CompanyInput): CompanyCheck {
	const problems = [
		taxCodeProblem(input.taxCode),
		companyTextProblem("company_name", input.companyName),
		companyTextProblem("address", input.address),
		emailProblem(input.email),
	].filter((problem): problem is CompanyProblem => problem !== null);
	if (problems.length > 0) return { problems, company: null };
	return {
		problems,
		company: {
			taxCode: normalizeTaxCode(input.taxCode) ?? "",
			companyName: trimSpaces(input.companyName),
			address: trimSpaces(input.address),
			email: trimSpaces(input.email),
		},
	};
}

/** A company on the wire, as the request functions take it. */
export function companyWire(
	company: Company,
): Readonly<Record<string, string>> {
	return {
		tax_code: company.taxCode,
		company_name: company.companyName,
		address: company.address,
		email: company.email,
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Answers

export const EINVOICE_KINDS = [
	"sale",
	"replacement",
	"adjustment",
	"cancellation",
] as const;
export type EInvoiceKind = (typeof EINVOICE_KINDS)[number];

export const EINVOICE_STATES = [
	"queued",
	"issuing",
	"issued",
	"failed",
	"replaced",
	"adjusted",
	"cancelled",
] as const;
export type EInvoiceState = (typeof EINVOICE_STATES)[number];

/** The order's e-invoice as the counter's pill and the customer read it (app.einvoice_pill). */
export const EINVOICE_PILL_STATES = [
	"pending",
	"issued",
	"retrying",
	"failed",
	"cancelled",
	"off",
	"none",
] as const;
export type EInvoicePillState = (typeof EINVOICE_PILL_STATES)[number];

export const INVOICE_REQUEST_STATUSES = [
	"received",
	"issuing",
	"issued",
	"emailed",
	"failed",
	"cancelled",
] as const;
export type InvoiceRequestStatus = (typeof INVOICE_REQUEST_STATUSES)[number];

/** Why a company invoice cannot be asked now (app.einvoice_request_refusal, and unknown_order for another's order). */
export const INVOICE_REFUSALS = [
	"unknown_order",
	"already_requested",
	"einvoice_off",
	"not_paid",
	"refunded",
	"nothing_to_invoice",
	"window_passed",
] as const;
export type InvoiceRefusal = (typeof INVOICE_REFUSALS)[number];

export interface EInvoiceDocument {
	readonly id: string;
	readonly kind: EInvoiceKind;
	readonly state: EInvoiceState;
	readonly mode: "sandbox" | "live" | null;
	readonly invoiceNo: string | null;
	readonly series: string | null;
	readonly lookupCode: string | null;
	/** an https address of the provider's lookup page, or null */
	readonly lookupUrl: string | null;
	readonly taxAuthorityCode: string | null;
	/** whole đồng, once the job fixed it */
	readonly amount: number | null;
	readonly issuedAt: string | null;
}

export interface EInvoicePill {
	readonly state: EInvoicePillState;
	readonly invoice: EInvoiceDocument | null;
	/** a company invoice is on its way to replace the issued sale invoice */
	readonly replacing: boolean;
	readonly correctionsPending: number;
	readonly attempts: number;
	readonly nextAttemptAt: string | null;
}

export interface InvoiceRequest {
	readonly id: string;
	readonly orderId: string;
	readonly source: "app" | "counter";
	readonly status: InvoiceRequestStatus;
	readonly taxCode: string;
	readonly companyName: string;
	readonly address: string;
	readonly email: string;
	readonly requestedAt: string;
	readonly issuedAt: string | null;
	readonly emailedAt: string | null;
	/** the company invoice once issued */
	readonly invoice: EInvoiceDocument | null;
}

/** C18 and C14: whether a company invoice can be asked for the order now, and what was asked. */
export type InvoiceStatus =
	| {
			readonly state: "unknown_order";
			readonly orderId: string;
	  }
	| {
			readonly state: "known";
			readonly orderId: string;
			readonly displayNo: string | null;
			readonly paidAt: string | null;
			/** what the order holds now (paid less refunded), whole đồng */
			readonly total: number;
			readonly eligible: boolean;
			readonly refusal: Exclude<InvoiceRefusal, "unknown_order"> | null;
			readonly windowDays: number;
			/** the last day a company invoice may be asked, YYYY-MM-DD (null before payment) */
			readonly lastDay: string | null;
			readonly request: InvoiceRequest | null;
			readonly einvoice: EInvoicePill | null;
	  };

export type RequestInvoiceAnswer =
	| {
			readonly state: "received";
			readonly replayed: boolean;
			readonly request: InvoiceRequest;
			/** whether the company was kept for next time (null on a replay) */
			readonly saved: boolean | null;
	  }
	| {
			readonly state: "refused";
			/** rate_limited, unknown_order, unknown_company, request_conflict, a refusal of the window, invalid… */
			readonly refusal: string;
			readonly retryAt: string | null;
			readonly lastDay: string | null;
			/** the fields in error (invalid) */
			readonly fields: readonly CompanyField[];
			/** the request already made (already_requested) */
			readonly request: InvoiceRequest | null;
	  };

export interface SavedCompany {
	readonly id: string;
	readonly taxCode: string;
	readonly companyName: string;
	readonly address: string;
	readonly email: string;
	readonly updatedAt: string;
}

export type DeleteSavedCompanyAnswer =
	| { readonly state: "deleted" }
	| { readonly state: "refused"; readonly refusal: string };

/** What the app sends for C18: one request id per attempt, the order, a company typed or saved. */
export type InvoiceRequestInput = {
	readonly requestId: string;
	readonly orderId: string;
	readonly save: boolean;
} & (
	| { readonly company: Company; readonly savedCompany?: undefined }
	| { readonly savedCompany: string; readonly company?: undefined }
);

type Row = Readonly<Record<string, unknown>>;

function invalid(what: string): never {
	throw new Error(`the invoice answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Row)
		: invalid(what);
}

function uuid(value: unknown, what: string): string {
	return typeof value === "string" && UUID.test(value) ? value : invalid(what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function optionalInstant(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : instant(value, what);
}

function optionalText(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value : invalid(what);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" ? value : invalid(what);
}

function code(value: unknown, what: string): string {
	return typeof value === "string" && CODE_PATTERN.test(value)
		? value
		: invalid(what);
}

function count(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: invalid(what);
}

function money(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: invalid(what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

function day(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && DAY_PATTERN.test(value)
		? value
		: invalid(what);
}

/** An e-invoice record as the readers show it (app.einvoice_doc_json); a lookup address that is not https is dropped. */
export function readEInvoiceDocument(value: unknown): EInvoiceDocument {
	const row = record(value, "e-invoice");
	const lookupUrl = optionalText(row.lookup_url, "lookup address");
	return {
		id: uuid(row.id, "e-invoice id"),
		kind: oneOf(EINVOICE_KINDS, row.kind, "e-invoice kind"),
		state: oneOf(EINVOICE_STATES, row.state, "e-invoice state"),
		mode:
			row.mode === null || row.mode === undefined
				? null
				: oneOf(["sandbox", "live"] as const, row.mode, "e-invoice mode"),
		invoiceNo: optionalText(row.invoice_no, "invoice number"),
		series: optionalText(row.series, "invoice series"),
		lookupCode: optionalText(row.lookup_code, "lookup code"),
		lookupUrl:
			lookupUrl !== null && /^https:\/\/[^\s"<>]+$/.test(lookupUrl)
				? lookupUrl
				: null,
		taxAuthorityCode: optionalText(
			row.tax_authority_code,
			"tax authority code",
		),
		amount:
			row.amount === null || row.amount === undefined
				? null
				: money(row.amount, "e-invoice amount"),
		issuedAt: optionalInstant(row.issued_at, "issued time"),
	};
}

function optionalDocument(value: unknown): EInvoiceDocument | null {
	return value === null || value === undefined
		? null
		: readEInvoiceDocument(value);
}

/** The order's e-invoice pill (app.einvoice_pill), from the customer's status or the counter's answer. */
export function readEInvoicePill(value: unknown): EInvoicePill {
	const row = record(value, "e-invoice pill");
	return {
		state: oneOf(EINVOICE_PILL_STATES, row.state, "e-invoice pill state"),
		invoice: optionalDocument(row.invoice),
		replacing: row.replacing === true,
		correctionsPending: count(row.corrections_pending ?? 0, "corrections"),
		attempts: count(row.attempts ?? 0, "attempts"),
		nextAttemptAt: optionalInstant(row.next_attempt_at, "next attempt"),
	};
}

/** A company invoice request (app.invoice_request_json): the buyer's data, its status and, once issued, the invoice. */
export function readInvoiceRequest(value: unknown): InvoiceRequest {
	const row = record(value, "invoice request");
	return {
		id: uuid(row.id, "request id"),
		orderId: uuid(row.order_id, "request order"),
		source: oneOf(["app", "counter"] as const, row.source, "request source"),
		status: oneOf(INVOICE_REQUEST_STATUSES, row.status, "request status"),
		taxCode: text(row.tax_code, "tax code"),
		companyName: text(row.company_name, "company name"),
		address: text(row.address, "address"),
		email: text(row.email, "email"),
		requestedAt: instant(row.requested_at, "requested time"),
		issuedAt: optionalInstant(row.issued_at, "request issued"),
		emailedAt: optionalInstant(row.emailed_at, "request emailed"),
		invoice: optionalDocument(row.invoice),
	};
}

function optionalRequest(value: unknown): InvoiceRequest | null {
	return value === null || value === undefined
		? null
		: readInvoiceRequest(value);
}

export function readInvoiceStatus(value: unknown): InvoiceStatus {
	const row = record(value, "invoice status");
	const orderId = uuid(row.order_id, "status order");
	if (row.refusal === "unknown_order")
		return { state: "unknown_order", orderId };
	const eligible = row.eligible === true;
	const refusal =
		row.refusal === null || row.refusal === undefined
			? null
			: oneOf(
					INVOICE_REFUSALS.filter(
						(
							candidate,
						): candidate is Exclude<InvoiceRefusal, "unknown_order"> =>
							candidate !== "unknown_order",
					),
					row.refusal,
					"status refusal",
				);
	if (eligible === (refusal !== null)) invalid("status eligibility");
	return {
		state: "known",
		orderId,
		displayNo: optionalText(row.display_no, "order number"),
		paidAt: optionalInstant(row.paid_at, "paid time"),
		total: money(row.total ?? 0, "order total"),
		eligible,
		refusal,
		windowDays: count(row.window_days ?? 0, "window days"),
		lastDay: day(row.last_day, "last day"),
		request: optionalRequest(row.request),
		einvoice:
			row.einvoice === null || row.einvoice === undefined
				? null
				: readEInvoicePill(row.einvoice),
	};
}

export function readRequestInvoiceAnswer(value: unknown): RequestInvoiceAnswer {
	const row = record(value, "invoice request answer");
	if (row.state === "received")
		return {
			state: "received",
			replayed: row.replayed === true,
			request: readInvoiceRequest(row.request),
			saved: typeof row.saved === "boolean" ? row.saved : null,
		};
	if (row.state === "refused") {
		const fields = Array.isArray(row.fields)
			? row.fields.map((field) => oneOf(COMPANY_FIELDS, field, "field"))
			: [];
		return {
			state: "refused",
			refusal: code(row.refusal, "request refusal"),
			retryAt: optionalInstant(row.retry_at, "retry time"),
			lastDay: day(row.last_day, "last day"),
			fields,
			request: optionalRequest(row.request),
		};
	}
	return invalid("request state");
}

export function readSavedCompany(value: unknown): SavedCompany {
	const row = record(value, "saved company");
	return {
		id: uuid(row.id, "saved company id"),
		taxCode: text(row.tax_code, "saved tax code"),
		companyName: text(row.company_name, "saved company name"),
		address: text(row.address, "saved address"),
		email: text(row.email, "saved email"),
		updatedAt: instant(row.updated_at, "saved company time"),
	};
}

export function readSavedCompanies(value: unknown): {
	readonly companies: readonly SavedCompany[];
} {
	const row = record(value, "saved companies");
	if (!Array.isArray(row.companies)) invalid("saved companies list");
	return { companies: row.companies.map(readSavedCompany) };
}

export function readDeleteSavedCompanyAnswer(
	value: unknown,
): DeleteSavedCompanyAnswer {
	const row = record(value, "saved company deletion");
	if (row.state === "deleted") return { state: "deleted" };
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: code(row.refusal, "deletion refusal"),
		};
	return invalid("deletion state");
}

export function invoiceStatusArgs(
	orderId: string,
): Readonly<Record<string, unknown>> {
	if (!UUID.test(orderId)) throw new Error("an order id is a UUID");
	return { p_order: orderId };
}

export function savedCompanyArgs(
	companyId: string,
): Readonly<Record<string, unknown>> {
	if (!UUID.test(companyId)) throw new Error("a saved company id is a UUID");
	return { p_company: companyId };
}

/** customer_request_invoice's argument: exactly one of a company and a saved company, ids checked before a call. */
export function requestInvoiceArgs(
	input: InvoiceRequestInput,
): Readonly<Record<string, unknown>> {
	if (!UUID.test(input.requestId) || !UUID.test(input.orderId))
		throw new Error("a request and its order are named by UUIDs");
	if (input.savedCompany !== undefined) {
		if (!UUID.test(input.savedCompany))
			throw new Error("a saved company id is a UUID");
		return {
			p_request: {
				request_id: input.requestId,
				order: input.orderId,
				saved_company: input.savedCompany,
				save: input.save,
			},
		};
	}
	return {
		p_request: {
			request_id: input.requestId,
			order: input.orderId,
			company: companyWire(input.company),
			save: input.save,
		},
	};
}
