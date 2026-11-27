import type {
	CompanyField,
	CompanyInput,
	CompanyProblem,
	EInvoicePill,
	InvoiceRequest,
	InvoiceRequestStatus,
	InvoiceStatus,
	SavedCompany,
} from "@fnb/zalo-mini/ordering";

// How the customer app shows a company invoice (C18; missing-screens README 5.7; native-till.md 17.5, 17.6). The
// database decides everything (whether it can be asked, the window, the fields); these only pick the words and the
// steps from its answers. The checks of the form are @fnb/zalo-mini's checkCompany, the mirror of the server's.

/** The words under a field in error: a message key and its values. */
export function problemMessage(problem: CompanyProblem): {
	readonly key: string;
	readonly params: Readonly<Record<string, string | number>>;
} {
	switch (problem.field) {
		case "tax_code":
			return {
				key: `invoice.error.tax_code.${problem.kind}`,
				params: problem.kind === "digits" ? { count: problem.count } : {},
			};
		case "company_name":
		case "address":
			return problem.kind === "empty"
				? { key: `invoice.error.${problem.field}.empty`, params: {} }
				: {
						key: `invoice.error.text.${problem.kind}`,
						params: { max: problem.max },
					};
		default:
			return { key: `invoice.error.email.${problem.kind}`, params: {} };
	}
}

export const EMPTY_COMPANY: CompanyInput = {
	taxCode: "",
	companyName: "",
	address: "",
	email: "",
};

/** A saved company as the form shows it once its chip is chosen. */
export function inputOf(company: SavedCompany): CompanyInput {
	return {
		taxCode: company.taxCode,
		companyName: company.companyName,
		address: company.address,
		email: company.email,
	};
}

export const FIELD_KEYS: Readonly<Record<CompanyField, keyof CompanyInput>> = {
	tax_code: "taxCode",
	company_name: "companyName",
	address: "address",
	email: "email",
};

export type StepState = "done" | "current" | "todo";

export interface RequestStep {
	readonly key: "received" | "issuing" | "emailed";
	readonly state: StepState;
	readonly at: string | null;
}

/** The three steps of a request (received, issuing, emailed) from its status, as frame 4 draws them. */
export function requestSteps(request: InvoiceRequest): readonly RequestStep[] {
	const progress: Readonly<Record<InvoiceRequestStatus, readonly StepState[]>> =
		{
			received: ["done", "current", "todo"],
			issuing: ["done", "current", "todo"],
			failed: ["done", "current", "todo"],
			issued: ["done", "done", "current"],
			emailed: ["done", "done", "done"],
			cancelled: ["done", "todo", "todo"],
		};
	const [received, issuing, emailed] = progress[request.status];
	return [
		{ key: "received", state: received ?? "done", at: request.requestedAt },
		{ key: "issuing", state: issuing ?? "todo", at: request.issuedAt },
		{ key: "emailed", state: emailed ?? "todo", at: request.emailedAt },
	];
}

/**
 * Whether the request is slower than it should be: the provider failed its company invoice (the job retries, or a
 * manager will), or the order's e-invoice keeps failing before the company invoice can replace it.
 */
export function slowRequest(
	request: InvoiceRequest,
	pill: EInvoicePill | null,
): boolean {
	if (request.status === "failed") return true;
	if (request.status !== "received" && request.status !== "issuing")
		return false;
	return pill?.state === "retrying" || pill?.state === "failed";
}

/** What the order screen offers about a company invoice, from customer_invoice_status. */
export type InvoiceEntry =
	| { readonly kind: "ask"; readonly lastDay: string | null }
	| { readonly kind: "requested"; readonly request: InvoiceRequest }
	| { readonly kind: "late" }
	| null;

export function invoiceEntry(status: InvoiceStatus): InvoiceEntry {
	if (status.state === "unknown_order") return null;
	if (status.request !== null)
		return { kind: "requested", request: status.request };
	if (status.eligible) return { kind: "ask", lastDay: status.lastDay };
	if (status.refusal === "window_passed") return { kind: "late" };
	return null;
}

/** The short label of a request's status, on the order screen. */
export function statusKey(
	request: InvoiceRequest,
	pill: EInvoicePill | null,
): string {
	if (slowRequest(request, pill)) return "invoice.status.slow";
	return `invoice.status.${request.status}`;
}

/** The refusals a send can meet that the screen words; any other is worded in general. */
export const WORDED_REFUSALS = [
	"einvoice_off",
	"not_paid",
	"refunded",
	"nothing_to_invoice",
	"rate_limited",
	"unknown_company",
	"request_conflict",
] as const;

export function refusalKey(refusal: string): string {
	return (WORDED_REFUSALS as readonly string[]).includes(refusal)
		? `invoice.refusal.${refusal}`
		: "invoice.refusal.other";
}
