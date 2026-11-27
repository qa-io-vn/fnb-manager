import {
	type Company,
	type CompanyField,
	type CompanyInput,
	type CompanyProblem,
	companyWire,
	type EInvoicePill,
	type EInvoicePillState,
	type InvoiceRequest,
	type RequestInvoiceAnswer,
	readEInvoicePill,
	readInvoiceRequest,
	readRequestInvoiceAnswer,
} from "@fnb/zalo-mini/ordering";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../lib/rpc";
import type { Order } from "./types";

// The counter's e-invoices (Q01; native-till.md 17.6; docs/api.md 3.30): the pill of an order (counter_order_einvoice),
// the company invoice row of a counter order (counter_request_invoice, the same fields and checks as C18, checked
// again by the server), and the managers' list of failing documents with a retry (manager_einvoices,
// manager_retry_einvoice). The answers are read by @fnb/zalo-mini's strict readers; the server decides every state.

/** The counter's answer: the pill and the company request of the order. */
export interface CounterEInvoice extends EInvoicePill {
	readonly orderId: string;
	readonly request: InvoiceRequest | null;
}

export function readCounterEInvoice(value: unknown): CounterEInvoice {
	const pill = readEInvoicePill(value);
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.order_id !== "string")
		throw new Error("the e-invoice answer has no order");
	return {
		...pill,
		orderId: row.order_id,
		request:
			row.request === null || row.request === undefined
				? null
				: readInvoiceRequest(row.request),
	};
}

export async function orderEInvoice(
	client: SupabaseClient,
	orderId: string,
): Promise<CounterEInvoice> {
	return readCounterEInvoice(
		await rpc<unknown>(client, "counter_order_einvoice", { p_order: orderId }),
	);
}

/** Q01's company row: one request id per attempt (a retry sends the same id and the server answers the first). */
export async function requestCompanyInvoice(
	client: SupabaseClient,
	orderId: string,
	requestId: string,
	company: Company,
): Promise<RequestInvoiceAnswer> {
	return readRequestInvoiceAnswer(
		await rpc<unknown>(client, "counter_request_invoice", {
			p_order: orderId,
			p_request: { request_id: requestId, company: companyWire(company) },
		}),
	);
}

/** What the pill says and how it looks: words, never colour alone (Q01 "Đang xuất…", "Đã xuất", the retry line). */
export const PILL_TONE: Readonly<
	Record<
		EInvoicePillState,
		"positive" | "warning" | "negative" | "neutral" | null
	>
> = {
	pending: "neutral",
	issued: "positive",
	retrying: "warning",
	failed: "negative",
	cancelled: "neutral",
	// nothing to show: e-invoicing is off at the store, or the order holds nothing to invoice
	off: null,
	none: null,
};

/**
 * Whether the cashier may key a company for this order: a counter order (an app order's customer asks in the app),
 * paid, no request yet, with e-invoicing on. The server checks it all again and words what it refuses.
 */
export function companyRowOpen(
	order: Pick<Order, "source" | "payment_status">,
	einvoice: Pick<CounterEInvoice, "state" | "request"> | null,
): boolean {
	return (
		order.source === "counter" &&
		order.payment_status === "paid" &&
		einvoice !== null &&
		einvoice.request === null &&
		einvoice.state !== "off" &&
		einvoice.state !== "none"
	);
}

/** Read again while the job may still change it; settled states are read only with the order. */
export function stillMoving(einvoice: CounterEInvoice | undefined): boolean {
	if (einvoice === undefined) return false;
	if (einvoice.state === "pending" || einvoice.state === "retrying")
		return true;
	return (
		einvoice.request !== null &&
		(einvoice.request.status === "received" ||
			einvoice.request.status === "issuing" ||
			einvoice.request.status === "issued")
	);
}

/** The words of a field's problem at the counter (the same checks as C18, in the staff screens' neutral voice). */
export function counterProblem(problem: CompanyProblem): {
	readonly key: string;
	readonly params: Readonly<Record<string, string | number>>;
} {
	switch (problem.field) {
		case "tax_code":
			return {
				key: `company.error.tax_code.${problem.kind}`,
				params: problem.kind === "digits" ? { count: problem.count } : {},
			};
		case "company_name":
		case "address":
			return problem.kind === "empty"
				? { key: `company.error.${problem.field}.empty`, params: {} }
				: {
						key: `company.error.text.${problem.kind}`,
						params: { max: problem.max },
					};
		default:
			return { key: `company.error.email.${problem.kind}`, params: {} };
	}
}

export const EMPTY_INPUT: CompanyInput = {
	taxCode: "",
	companyName: "",
	address: "",
	email: "",
};

export const INPUT_KEYS: Readonly<Record<CompanyField, keyof CompanyInput>> = {
	tax_code: "taxCode",
	company_name: "companyName",
	address: "address",
	email: "email",
};

/** The refusals of counter_request_invoice the counter words; any other is worded in general. */
export const COUNTER_REFUSALS = [
	"not_counter_order",
	"already_requested",
	"einvoice_off",
	"not_paid",
	"refunded",
	"nothing_to_invoice",
	"window_passed",
	"request_conflict",
	"invalid",
] as const;

export function counterRefusalKey(refusal: string): string {
	return (COUNTER_REFUSALS as readonly string[]).includes(refusal)
		? `company.refusal.${refusal}`
		: "company.refusal.other";
}

// ---------------------------------------------------------------------------------------------------------------
// The managers' list (manager_einvoices, manager_retry_einvoice)

export const EINVOICE_FILTERS = ["failing", "pending", "all"] as const;
export type EInvoiceFilter = (typeof EINVOICE_FILTERS)[number];

export interface ManagerEInvoice {
	readonly id: string;
	readonly kind: string;
	readonly state: string;
	readonly invoice_no: string | null;
	readonly order_id: string;
	readonly display_no: string | null;
	readonly business_date: string;
	readonly reason: string;
	readonly attempts: number;
	readonly last_error_class: string | null;
	readonly last_attempt_at: string | null;
	readonly next_attempt_at: string | null;
	readonly gave_up_at: string | null;
	readonly queued_at: string;
	readonly request_status: string | null;
}

export interface ManagerEInvoices {
	readonly failing: number;
	readonly gave_up: number;
	readonly pending: number;
	readonly emails_failing: number;
	readonly invoices: readonly ManagerEInvoice[];
}

export const managerEInvoices = (
	client: SupabaseClient,
	store: string,
	filter: EInvoiceFilter,
	limit = 50,
) =>
	rpc<ManagerEInvoices>(client, "manager_einvoices", {
		p_store: store,
		p_filter: filter,
		p_limit: limit,
	});

export const retryEInvoice = (client: SupabaseClient, invoice: string) =>
	rpc<{ readonly state: string; readonly refusal: string | null }>(
		client,
		"manager_retry_einvoice",
		{ p_invoice: invoice },
	);

/** The error classes the job records (app.einvoice_error_classes); another is worded as unknown. */
export const ERROR_CLASSES = [
	"timeout",
	"unavailable",
	"rate_limited",
	"rejected_auth",
	"not_configured",
	"rejected_data",
	"rejected_duplicate",
	"unsupported",
	"unknown",
] as const;

export function errorClassKey(errorClass: string | null): string {
	return errorClass !== null &&
		(ERROR_CLASSES as readonly string[]).includes(errorClass)
		? `einvoices.error.${errorClass}`
		: "einvoices.error.unknown";
}

/** A document a manager may send again: only a failed one (manager_retry_einvoice refuses any other with not_failed). */
export function retryable(invoice: Pick<ManagerEInvoice, "state">): boolean {
	return invoice.state === "failed";
}

/** The managers' badge: the documents that failed (retrying or given up), as manager_einvoices counts them. */
export function attentionCount(list: ManagerEInvoices | undefined): number {
	return list === undefined ? 0 : list.failing;
}
