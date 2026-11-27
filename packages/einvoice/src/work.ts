import {
	type EInvoiceProviderConfig,
	readEInvoiceProviderConfig,
} from "./config.js";
import {
	composeInvoiceMail,
	type InvoiceMailer,
	MailError,
	type MailErrorClass,
} from "./mailer.js";
import {
	type Buyer,
	type EInvoiceErrorClass,
	type EInvoiceProvider,
	EInvoiceRefusedError,
	errorClassOf,
	type InvoiceLine,
	type InvoiceOperation,
	type IssuedInvoice,
	isRecord,
	type OriginalInvoice,
	type PaymentMethod,
} from "./types.js";

/**
 * One document of the job's work list (app.einvoice_job_item) and the job's decision for it, shared by the einvoice-job
 * Edge Function and the tests: an attempt after the first asks the provider for the document by our id before making
 * it (a lost answer never makes a second invoice); a sale or company invoice with nothing left to invoice, or a
 * correction with nothing to change, that the provider never made is reported not_found; a cancellation the provider
 * refuses becomes an adjustment to zero; every failure is reported by its class only.
 */

export type DocumentKind =
	| "sale"
	| "replacement"
	| "adjustment"
	| "cancellation";

export interface WorkItem {
	readonly invoiceId: string;
	readonly claim: string;
	readonly kind: DocumentKind;
	readonly action: InvoiceOperation;
	readonly reason: string;
	readonly queryFirst: boolean;
	/** a sale or company invoice's total, or a correction's change (negative for a refund) */
	readonly amount: number;
	readonly soldAt: string;
	readonly orderLabel: string | null;
	readonly storeName: string;
	readonly lines: readonly InvoiceLine[];
	readonly paymentMethods: readonly PaymentMethod[];
	readonly buyer: Buyer | null;
	readonly original: OriginalInvoice | null;
	readonly provider: EInvoiceProviderConfig;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly string[] = [
	"sale",
	"replacement",
	"adjustment",
	"cancellation",
];
const ACTIONS: readonly string[] = ["issue", "replace", "adjust", "cancel"];
const METHODS: readonly string[] = ["cash", "card", "zalo_checkout", "vietqr"];

function text(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function whole(value: unknown): number | null {
	return typeof value === "number" && Number.isSafeInteger(value)
		? value
		: null;
}

function readLines(value: unknown): InvoiceLine[] | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const lines: InvoiceLine[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) {
			return null;
		}
		const name = text(entry.name);
		const quantity = whole(entry.quantity);
		const unitPrice = whole(entry.unit_price);
		const amount = whole(entry.amount);
		if (
			name === null ||
			quantity === null ||
			unitPrice === null ||
			amount === null
		) {
			return null;
		}
		lines.push({ name, quantity, unitPrice, amount });
	}
	return lines;
}

function readBuyer(value: unknown): Buyer | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	const taxCode = text(value.tax_code);
	const companyName = text(value.company_name);
	const address = text(value.address);
	const email = text(value.email);
	if (
		taxCode === null ||
		companyName === null ||
		address === null ||
		email === null
	) {
		return undefined;
	}
	return { taxCode, companyName, address, email };
}

function readOriginal(value: unknown): OriginalInvoice | null | undefined {
	if (value === null || value === undefined) {
		return null;
	}
	if (!isRecord(value)) {
		return undefined;
	}
	const invoiceId = text(value.invoice_id);
	const providerRef = text(value.provider_ref);
	const issuedAt = text(value.issued_at);
	const amount = whole(value.amount);
	if (
		invoiceId === null ||
		!UUID.test(invoiceId) ||
		providerRef === null ||
		issuedAt === null ||
		amount === null
	) {
		return undefined;
	}
	return {
		invoiceId,
		providerRef,
		invoiceNo: text(value.invoice_no),
		series: text(value.series),
		issuedAt,
		amount,
	};
}

/** Reads one document of the work list; null when anything is missing or out of shape (the job reports it as failed). */
export function readWorkItem(value: unknown): WorkItem | null {
	if (!isRecord(value) || !isRecord(value.order)) {
		return null;
	}
	const invoiceId = text(value.invoice_id);
	const claim = text(value.claim);
	const kind = text(value.kind);
	const action = text(value.action);
	const amount = whole(value.amount);
	const soldAt = text(value.sold_at);
	const storeName = text(value.order.store_name);
	const lines = readLines(value.lines);
	const buyer = readBuyer(value.buyer);
	const original = readOriginal(value.original);
	const provider = readEInvoiceProviderConfig(value.provider);
	const methods = Array.isArray(value.payment_methods)
		? value.payment_methods
		: null;
	if (
		invoiceId === null ||
		!UUID.test(invoiceId) ||
		claim === null ||
		!UUID.test(claim) ||
		kind === null ||
		!KINDS.includes(kind) ||
		action === null ||
		!ACTIONS.includes(action) ||
		typeof value.query_first !== "boolean" ||
		amount === null ||
		soldAt === null ||
		storeName === null ||
		lines === null ||
		buyer === undefined ||
		original === undefined ||
		provider === null ||
		methods === null ||
		!methods.every(
			(method) => typeof method === "string" && METHODS.includes(method),
		) ||
		(kind === "replacement" && (buyer === null || original === null)) ||
		(action !== "issue" &&
			action !== "replace" &&
			original === null &&
			amount !== 0)
	) {
		return null;
	}
	return {
		invoiceId,
		claim,
		kind: kind as DocumentKind,
		action: action as InvoiceOperation,
		reason: text(value.reason) ?? "refund",
		queryFirst: value.query_first,
		amount,
		soldAt,
		orderLabel: text(value.order.display_no),
		storeName,
		lines,
		paymentMethods: methods as PaymentMethod[],
		buyer,
		original,
		provider,
	};
}

export type JobResult =
	| { readonly outcome: "issued"; readonly invoice: IssuedInvoice }
	| { readonly outcome: "not_found" }
	| { readonly outcome: "failed"; readonly errorClass: EInvoiceErrorClass };

const REASONS: Readonly<Record<string, string>> = {
	refund: "Điều chỉnh giảm theo số tiền đã hoàn cho khách",
	payment_voided: "Thanh toán bị hủy tại quầy",
	company_invoice: "Thay thế hóa đơn bán lẻ bằng hóa đơn có tên đơn vị mua",
	paid: "Hóa đơn bán hàng",
};

/** Runs one document against its provider and answers what the job reports to the database. */
export async function runWorkItem(
	item: WorkItem,
	provider: EInvoiceProvider,
	at: Date,
): Promise<JobResult> {
	try {
		if (item.queryFirst) {
			const found = await provider.query(item.invoiceId);
			if (found !== null) {
				return { outcome: "issued", invoice: found };
			}
		}
		const nothingToSend =
			item.kind === "sale" || item.kind === "replacement"
				? item.amount <= 0
				: item.amount === 0 || item.original === null;
		if (nothingToSend) {
			// the database settles such a document itself unless an earlier attempt may have reached the provider
			return item.queryFirst
				? { outcome: "not_found" }
				: { outcome: "failed", errorClass: "rejected_data" };
		}
		const seller = item.provider.seller;
		const reason = REASONS[item.reason] ?? REASONS.refund ?? "";
		const issue = {
			invoiceId: item.invoiceId,
			soldAt: item.soldAt,
			amount: item.amount,
			seller,
			buyer: item.buyer,
			lines: item.lines,
			paymentMethods: item.paymentMethods,
			orderLabel: item.orderLabel,
			storeName: item.storeName,
		};
		switch (item.action) {
			case "issue":
				return { outcome: "issued", invoice: await provider.issue(issue) };
			case "replace": {
				if (item.buyer === null || item.original === null) {
					throw new EInvoiceRefusedError(
						"rejected_data",
						"a replacement needs its buyer and its original",
					);
				}
				return {
					outcome: "issued",
					invoice: await provider.replace({
						...issue,
						buyer: item.buyer,
						original: item.original,
					}),
				};
			}
			case "adjust":
				return {
					outcome: "issued",
					invoice: await provider.adjust({
						invoiceId: item.invoiceId,
						original: item.original as OriginalInvoice,
						amount: item.amount,
						seller,
						reason,
						at: at.toISOString(),
					}),
				};
			case "cancel": {
				const original = item.original as OriginalInvoice;
				const cancelled = await provider.cancel({
					invoiceId: item.invoiceId,
					original,
					seller,
					reason,
					at: at.toISOString(),
				});
				if (cancelled !== "unsupported") {
					return { outcome: "issued", invoice: cancelled };
				}
				// the provider (or the law) cancels no valid invoice: the same effect is an adjustment to zero
				return {
					outcome: "issued",
					invoice: await provider.adjust({
						invoiceId: item.invoiceId,
						original,
						amount: -original.amount,
						seller,
						reason,
						at: at.toISOString(),
					}),
				};
			}
		}
	} catch (error) {
		return { outcome: "failed", errorClass: errorClassOf(error) };
	}
}

/** The database's result request for a job result (app.einvoice_job_result). */
export function resultRequest(
	item: WorkItem,
	result: JobResult,
): Record<string, unknown> {
	const base = {
		kind: "invoice",
		invoice_id: item.invoiceId,
		claim: item.claim,
	};
	if (result.outcome === "failed") {
		return { ...base, outcome: "failed", error_class: result.errorClass };
	}
	if (result.outcome === "not_found") {
		return { ...base, outcome: "not_found" };
	}
	const invoice = result.invoice;
	return {
		...base,
		outcome: "issued",
		action: invoice.operation,
		provider_ref: invoice.providerRef,
		invoice_no: invoice.invoiceNo,
		series: invoice.series,
		lookup_code: invoice.lookupCode,
		lookup_url: invoice.lookupUrl,
		tax_authority_code: invoice.taxAuthorityCode,
		amount: invoice.amount,
		emailed: invoice.emailed,
	};
}

export interface EmailItem {
	readonly requestId: string;
	readonly to: string;
	readonly companyName: string;
	readonly taxCode: string;
	readonly orderLabel: string | null;
	readonly storeName: string;
	readonly invoiceNo: string | null;
	readonly series: string | null;
	readonly lookupCode: string | null;
	readonly lookupUrl: string | null;
	readonly amount: number | null;
}

/** Reads one company invoice email of the work list; null when out of shape. */
export function readEmailItem(value: unknown): EmailItem | null {
	if (!isRecord(value)) {
		return null;
	}
	const requestId = text(value.request_id);
	const to = text(value.to);
	const companyName = text(value.company_name);
	const taxCode = text(value.tax_code);
	const storeName = text(value.store_name);
	const invoice = isRecord(value.invoice) ? value.invoice : {};
	if (
		requestId === null ||
		!UUID.test(requestId) ||
		to === null ||
		companyName === null ||
		taxCode === null ||
		storeName === null
	) {
		return null;
	}
	return {
		requestId,
		to,
		companyName,
		taxCode,
		orderLabel: text(value.order_display_no),
		storeName,
		invoiceNo: text(invoice.invoice_no),
		series: text(invoice.series),
		lookupCode: text(invoice.lookup_code),
		lookupUrl: text(invoice.lookup_url),
		amount: whole(invoice.amount),
	};
}

export type EmailResult =
	| { readonly ok: true }
	| { readonly ok: false; readonly errorClass: MailErrorClass };

/** Sends one company invoice email through the mailer (none configured: no_mailer). */
export async function runEmailItem(
	item: EmailItem,
	mailer: InvoiceMailer | null,
): Promise<EmailResult> {
	if (mailer === null) {
		return { ok: false, errorClass: "no_mailer" };
	}
	try {
		await mailer.send(composeInvoiceMail(item));
		return { ok: true };
	} catch (error) {
		return {
			ok: false,
			errorClass: error instanceof MailError ? error.errorClass : "unknown",
		};
	}
}

export function emailResultRequest(
	item: EmailItem,
	result: EmailResult,
): Record<string, unknown> {
	return result.ok
		? { kind: "email", request_id: item.requestId, ok: true }
		: {
				kind: "email",
				request_id: item.requestId,
				ok: false,
				error_class: result.errorClass,
			};
}
