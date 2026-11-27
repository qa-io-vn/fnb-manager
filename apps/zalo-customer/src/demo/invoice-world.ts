import { RestError } from "@fnb/zalo-mini";
import { REFUSAL_INVALID } from "@fnb/zalo-mini/loyalty";
import {
	type CompanyField,
	checkCompany,
	type EInvoicePillState,
	INVOICE_FUNCTIONS,
	type InvoiceRequestStatus,
	SAVED_COMPANIES_MAX,
} from "@fnb/zalo-mini/ordering";
import { addDays, isoDateIn } from "../data/dates";

// The e-invoice functions of the customer (docs/api.md 3.30; native-till.md 17.5, 17.6) in the demo world, answered at
// the wire level so the app's readers and REST client run as in production. It follows the server's rules where the
// screens depend on them: one request per order, idempotent per request id (a replay answers the first, another
// company under the same id is a conflict), the refusals in the server's order (rate limit, unknown order, unknown
// company, then already requested, e-invoicing off, not paid, refunded, nothing to invoice, the window), the window
// of 7 days from the payment's local date (day 7 yes, day 8 no), the fields checked again, at most 10 saved companies
// a login. The till moves an order's e-invoice and its company invoice the way the job does on the real stack.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WINDOW_DAYS = 7;
const RATE_LIMIT = 10;
const HOUR = 3_600_000;
const SALE_NUMBER = "000127";
const COMPANY_NUMBER = "000128";

/** What the invoice world reads of an order of the ordering world. */
export interface InvoiceOrder {
	readonly id: string;
	readonly orderNo: number | null;
	readonly paymentStatus: string;
	readonly status: string;
	readonly paidAt: string | null;
	readonly total: number;
}

/** The till's side of e-invoices, for tests. */
export interface DemoInvoiceTill {
	/** switches the store's e-invoice provider on or off */
	setEInvoice(on: boolean): void;
	/** moves an order's e-invoice (the latest order's when no id is given) as the job would */
	einvoice(
		state: "pending" | "issued" | "retrying" | "failed",
		orderId?: string,
	): void;
	/** moves an order's company invoice request: issuing, issued (the company invoice made), emailed or failed */
	companyInvoice(
		status: "issuing" | "issued" | "emailed" | "failed",
		orderId?: string,
	): void;
	/** moves an order's payment so many days back (the window's day 7 and day 8) */
	paidDaysAgo(days: number, orderId?: string): void;
	/** a company saved earlier, as a request with "Lưu công ty này cho lần sau" leaves it */
	saveCompany(company: {
		readonly tax_code: string;
		readonly company_name: string;
		readonly address: string;
		readonly email: string;
	}): string;
	/** how many company invoice requests the customer made (a replay is not one) */
	invoiceRequests(): number;
}

interface DemoDocument {
	readonly id: string;
	readonly kind: "sale" | "replacement";
	state: "queued" | "issued" | "failed" | "replaced";
	attempts: number;
	nextAttemptAt: string | null;
	issuedAt: string | null;
	invoiceNo: string | null;
	amount: number | null;
}

interface DemoInvoiceRequest {
	readonly id: string;
	readonly orderId: string;
	readonly clientId: string;
	readonly hash: string;
	status: InvoiceRequestStatus;
	readonly company: Readonly<Record<string, string>>;
	readonly requestedAt: string;
	issuedAt: string | null;
	emailedAt: string | null;
	document: DemoDocument;
}

interface DemoSavedCompany {
	readonly id: string;
	tax_code: string;
	company_name: string;
	address: string;
	email: string;
	readonly created_at: string;
	updated_at: string;
}

function invalidRequest(): never {
	throw new RestError(400, REFUSAL_INVALID);
}

function uuidOf(value: unknown): string | null {
	return typeof value === "string" && UUID.test(value) ? value : null;
}

export interface InvoiceWorld {
	answer(fn: string, args: Readonly<Record<string, unknown>>): unknown;
	readonly till: DemoInvoiceTill;
	readonly changingFunctions: readonly string[];
	/** a paid order: its sale invoice is queued while the provider is on */
	paid(order: InvoiceOrder): void;
	/** the export's sections of the customer's own requests and saved companies */
	exportSections(): {
		readonly invoice_requests: unknown[];
		readonly saved_companies: unknown[];
	};
	/** the login is deleted: its saved companies go, its requests stay with the orders but are no longer its own */
	accountDeleted(): void;
}

export function createInvoiceWorld(options: {
	readonly now: () => number;
	readonly einvoiceOn: boolean;
	readonly mine: (orderId: unknown) => InvoiceOrder | null;
	readonly target: (orderId?: string) => InvoiceOrder | undefined;
}): InvoiceWorld {
	const { now, mine, target } = options;
	let on = options.einvoiceOn;
	let count = 0;
	const documents = new Map<string, DemoDocument>();
	const requests = new Map<string, DemoInvoiceRequest>();
	const saved: DemoSavedCompany[] = [];
	const calls: number[] = [];
	let linked = true;

	const iso = () => new Date(now()).toISOString();
	const nextId = (prefix: string) => {
		count += 1;
		return `${prefix}-0000-4000-8000-${String(count).padStart(12, "0")}`;
	};
	const displayNo = (no: number | null) =>
		no === null ? null : `#${String(no).padStart(3, "0")}`;

	const documentJson = (document: DemoDocument | null | undefined) =>
		document === null || document === undefined
			? null
			: {
					id: document.id,
					kind: document.kind,
					state: document.state,
					mode:
						document.state === "issued" || document.state === "replaced"
							? "sandbox"
							: null,
					invoice_no: document.invoiceNo,
					series: document.invoiceNo === null ? null : "C26MAA",
					lookup_code:
						document.invoiceNo === null ? null : `TC${document.invoiceNo}`,
					lookup_url: null,
					tax_authority_code: null,
					amount: document.amount,
					issued_at: document.issuedAt,
				};

	const requestJson = (request: DemoInvoiceRequest | undefined) =>
		request === undefined
			? null
			: {
					id: request.id,
					order_id: request.orderId,
					source: "app",
					status: request.status,
					...request.company,
					requested_at: request.requestedAt,
					issued_at: request.issuedAt,
					emailed_at: request.emailedAt,
					invoice:
						request.document.state === "issued"
							? documentJson(request.document)
							: null,
				};

	const pillState = (order: InvoiceOrder): EInvoicePillState => {
		const sale = documents.get(order.id);
		const request = requests.get(order.id);
		const live =
			request?.document.state === "issued"
				? request.document
				: sale?.state === "issued"
					? sale
					: null;
		if (live !== null) return "issued";
		const head =
			request !== undefined &&
			request.document.state !== "issued" &&
			sale?.state === "replaced"
				? request.document
				: sale;
		if (head === undefined) return on ? "none" : "off";
		if (head.state === "failed")
			return head.nextAttemptAt === null ? "failed" : "retrying";
		return "pending";
	};

	const pillJson = (order: InvoiceOrder) => {
		const sale = documents.get(order.id);
		const request = requests.get(order.id);
		const shown =
			request?.document.state === "issued" ? request.document : sale;
		return {
			state: pillState(order),
			invoice: documentJson(shown),
			replacing:
				sale?.state === "issued" &&
				request !== undefined &&
				request.document.state !== "issued",
			corrections_pending: 0,
			attempts: shown?.attempts ?? 0,
			next_attempt_at: shown?.nextAttemptAt ?? null,
		};
	};

	const lastDay = (order: InvoiceOrder) =>
		order.paidAt === null
			? null
			: addDays(isoDateIn(Date.parse(order.paidAt)), WINDOW_DAYS);

	const net = (order: InvoiceOrder) =>
		order.paymentStatus === "paid" ? order.total : 0;

	// app.einvoice_request_refusal, in its order
	const refusalOf = (order: InvoiceOrder): string | null => {
		if (requests.has(order.id)) return "already_requested";
		if (!on) return "einvoice_off";
		if (order.paymentStatus === "unpaid" || order.paidAt === null)
			return "not_paid";
		if (order.paymentStatus !== "paid" || order.status === "cancelled")
			return "refunded";
		if (net(order) <= 0) return "nothing_to_invoice";
		const last = lastDay(order);
		if (last !== null && isoDateIn(now()) > last) return "window_passed";
		return null;
	};

	const status = (orderId: unknown) => {
		const order = mine(orderId);
		if (order === null)
			return {
				order_id: orderId,
				eligible: false,
				refusal: "unknown_order",
				request: null,
				einvoice: null,
			};
		const refusal = refusalOf(order);
		return {
			order_id: order.id,
			display_no: displayNo(order.orderNo),
			paid_at: order.paidAt,
			total: net(order),
			eligible: refusal === null,
			refusal,
			window_days: WINDOW_DAYS,
			last_day: lastDay(order),
			request: requestJson(requests.get(order.id)),
			einvoice: pillJson(order),
		};
	};

	const refused = (refusal: string, extra: Record<string, unknown> = {}) => ({
		state: "refused",
		refusal,
		request: null,
		...extra,
	});

	const request = (args: Readonly<Record<string, unknown>>) => {
		const body = args.p_request;
		if (typeof body !== "object" || body === null || Array.isArray(body))
			invalidRequest();
		const row = body as Readonly<Record<string, unknown>>;
		const clientId = uuidOf(row.request_id);
		const orderId = uuidOf(row.order);
		const savedId = uuidOf(row.saved_company);
		if (
			clientId === null ||
			orderId === null ||
			("saved_company" in row && savedId === null) ||
			("save" in row && typeof row.save !== "boolean") ||
			(savedId === null) === (row.company === undefined || row.company === null)
		)
			invalidRequest();
		const at = now();
		while (calls.length > 0 && (calls[0] ?? 0) <= at - HOUR) calls.shift();
		if (calls.length >= RATE_LIMIT)
			return refused("rate_limited", {
				retry_at: new Date((calls[0] ?? at) + HOUR).toISOString(),
			});
		calls.push(at);
		const order = mine(orderId);
		if (order === null || !linked) return refused("unknown_order");
		let company: Record<string, string>;
		let fields: CompanyField[] = [];
		if (savedId !== null) {
			const found = saved.find((entry) => entry.id === savedId);
			if (found === undefined) return refused("unknown_company");
			company = {
				tax_code: found.tax_code,
				company_name: found.company_name,
				address: found.address,
				email: found.email,
			};
		} else {
			const typed = row.company as Readonly<Record<string, unknown>>;
			const text = (key: string) =>
				typeof typed?.[key] === "string" ? (typed[key] as string) : "";
			const check = checkCompany({
				taxCode: text("tax_code"),
				companyName: text("company_name"),
				address: text("address"),
				email: text("email"),
			});
			fields = check.problems.map((problem) => problem.field);
			company =
				check.company === null
					? {}
					: {
							tax_code: check.company.taxCode,
							company_name: check.company.companyName,
							address: check.company.address,
							email: check.company.email,
						};
		}
		const hash = JSON.stringify(company);
		const existing = requests.get(order.id);
		if (existing !== undefined && existing.clientId === clientId) {
			if (fields.length === 0 && existing.hash === hash)
				return {
					state: "received",
					refusal: null,
					replayed: true,
					request: requestJson(existing),
					saved: null,
				};
			return refused("request_conflict");
		}
		const refusal = refusalOf(order);
		if (refusal !== null)
			return refused(refusal, {
				last_day: lastDay(order),
				request: refusal === "already_requested" ? requestJson(existing) : null,
			});
		if (fields.length > 0) return refused("invalid", { fields });
		const created: DemoInvoiceRequest = {
			id: nextId("66666666"),
			orderId: order.id,
			clientId,
			hash,
			status: "received",
			company,
			requestedAt: iso(),
			issuedAt: null,
			emailedAt: null,
			document: {
				id: nextId("55555555"),
				kind: "replacement",
				state: "queued",
				attempts: 0,
				nextAttemptAt: null,
				issuedAt: null,
				invoiceNo: null,
				amount: null,
			},
		};
		requests.set(order.id, created);
		let kept = false;
		if (row.save === true) {
			const same = saved.find((entry) => entry.tax_code === company.tax_code);
			if (same !== undefined) {
				Object.assign(same, company, { updated_at: iso() });
				kept = true;
			} else if (saved.length < SAVED_COMPANIES_MAX) {
				saved.push({
					id: nextId("44444444"),
					tax_code: company.tax_code ?? "",
					company_name: company.company_name ?? "",
					address: company.address ?? "",
					email: company.email ?? "",
					created_at: iso(),
					updated_at: iso(),
				});
				kept = true;
			}
		}
		return {
			state: "received",
			refusal: null,
			replayed: false,
			request: requestJson(created),
			saved: kept,
		};
	};

	const savedCompanies = () => ({
		companies: [...saved]
			.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
			.map(({ created_at: _created, ...entry }) => entry),
	});

	const deleteSaved = (id: unknown) => {
		const companyId = uuidOf(id);
		if (companyId === null) invalidRequest();
		const index = saved.findIndex((entry) => entry.id === companyId);
		if (index < 0) return { state: "refused", refusal: "unknown_company" };
		saved.splice(index, 1);
		return { state: "deleted", refusal: null };
	};

	const orderFor = (orderId?: string) => {
		const order = target(orderId);
		if (order === undefined) throw new Error("no such order");
		return order;
	};

	const till: DemoInvoiceTill = {
		setEInvoice(next) {
			on = next;
		},
		einvoice(state, orderId) {
			const order = orderFor(orderId);
			const sale = documents.get(order.id);
			if (sale === undefined) throw new Error("the order has no e-invoice");
			sale.state =
				state === "issued"
					? "issued"
					: state === "pending"
						? "queued"
						: "failed";
			sale.attempts = state === "pending" ? 0 : Math.max(1, sale.attempts + 1);
			sale.nextAttemptAt =
				state === "retrying"
					? new Date(now() + 2 * 60_000).toISOString()
					: null;
			sale.issuedAt = state === "issued" ? iso() : null;
			sale.invoiceNo = state === "issued" ? SALE_NUMBER : null;
			sale.amount = state === "issued" ? order.total : null;
		},
		companyInvoice(next, orderId) {
			const order = orderFor(orderId);
			const asked = requests.get(order.id);
			if (asked === undefined)
				throw new Error("the order has no company invoice request");
			asked.status = next;
			const document = asked.document;
			if (next === "issued" || next === "emailed") {
				document.state = "issued";
				document.issuedAt = document.issuedAt ?? iso();
				document.invoiceNo = COMPANY_NUMBER;
				document.amount = order.total;
				asked.issuedAt = asked.issuedAt ?? iso();
				const sale = documents.get(order.id);
				if (sale !== undefined && sale.state === "issued")
					sale.state = "replaced";
			}
			if (next === "emailed") asked.emailedAt = iso();
			if (next === "failed") {
				document.state = "failed";
				document.attempts += 1;
				document.nextAttemptAt = null;
			}
		},
		paidDaysAgo(days, orderId) {
			const order = orderFor(orderId) as { paidAt: string | null };
			if (order.paidAt === null) throw new Error("the order is not paid");
			order.paidAt = new Date(now() - days * 24 * HOUR).toISOString();
		},
		saveCompany(company) {
			const id = nextId("44444444");
			saved.push({ id, ...company, created_at: iso(), updated_at: iso() });
			return id;
		},
		invoiceRequests: () => requests.size,
	};

	return {
		till,
		changingFunctions: [
			INVOICE_FUNCTIONS.request,
			INVOICE_FUNCTIONS.deleteSavedCompany,
		],
		answer(fn, args) {
			switch (fn) {
				case INVOICE_FUNCTIONS.status:
					if (uuidOf(args.p_order) === null) invalidRequest();
					return status(args.p_order);
				case INVOICE_FUNCTIONS.request:
					return request(args);
				case INVOICE_FUNCTIONS.savedCompanies:
					return savedCompanies();
				case INVOICE_FUNCTIONS.deleteSavedCompany:
					return deleteSaved(args.p_company);
				default:
					return undefined;
			}
		},
		paid(order) {
			if (!on || documents.has(order.id)) return;
			documents.set(order.id, {
				id: nextId("55555555"),
				kind: "sale",
				state: "queued",
				attempts: 0,
				nextAttemptAt: null,
				issuedAt: null,
				invoiceNo: null,
				amount: null,
			});
		},
		exportSections() {
			return {
				invoice_requests: linked
					? [...requests.values()]
							.filter((entry) => mine(entry.orderId) !== null)
							.map(requestJson)
					: [],
				saved_companies: saved.map(
					({ id, tax_code, company_name, address, email, updated_at }) => ({
						id,
						tax_code,
						company_name,
						address,
						email,
						updated_at,
					}),
				),
			};
		},
		accountDeleted() {
			saved.length = 0;
			linked = false;
		},
	};
}
