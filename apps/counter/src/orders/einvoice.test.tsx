import { I18nProvider } from "@fnb/zalo-mini/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogs } from "../i18n/catalog";
import {
	attentionCount,
	companyRowOpen,
	counterProblem,
	counterRefusalKey,
	errorClassKey,
	PILL_TONE,
	readCounterEInvoice,
	requestCompanyInvoice,
	retryable,
	stillMoving,
} from "./einvoice";
import { CompanyDialog, EInvoiceCard } from "./einvoice-ui";
import type { Order } from "./types";

// counter:unit/einvoice (Q01's pill and company row, the managers' list; docs/api.md 3.30, native-till.md 17.6):
// - equivalence partitions of the pill's seven states: the words and the tone, none shown for off and none;
// - decision table of the company row: source (counter, app) × payment (unpaid, paid, refunded) × request (none, one)
//   × e-invoicing (on, off);
// - state transitions: read again while pending, retrying or a request on its way; settled states only with the order;
// - the company row's form (component): every field in error linked with aria-describedby and aria-invalid, focus on
//   the first; 13 bare digits sent hyphenated; a double tap and a retry after a lost answer send one request id; the
//   server's invalid fields marked; a ticket's company held without a call;
// - security (error guessing): a buyer's name with markup from the server is shown as text; the managers' list words
//   error classes only, an unknown class as unknown.

const ORDER = "99999999-0000-4000-8000-000000000042";
const INVOICE = "55555555-0000-4000-8000-000000000001";
const REQUEST = "66666666-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
	answers: [] as unknown[],
	failNext: false,
	calls: [] as { fn: string; args: unknown }[],
	toasts: [] as string[],
}));

vi.mock("../lib/session", () => ({
	useSession: () => ({
		client: {
			rpc: async (fn: string, args: unknown) => {
				state.calls.push({ fn, args });
				if (state.failNext) {
					state.failNext = false;
					throw new TypeError("Failed to fetch");
				}
				return { data: state.answers.shift() ?? null, error: null };
			},
		},
	}),
}));
vi.mock("../ui/toast", () => ({
	useToast: () => ({ show: (text: string) => state.toasts.push(text) }),
}));

function order(overrides: Partial<Order> = {}): Order {
	return {
		id: ORDER,
		order_no: 42,
		display_no: "#042",
		business_date: "2026-11-28",
		source: "counter",
		type: "takeaway",
		table: null,
		pickup_at: null,
		status: "accepted",
		payment_status: "paid",
		payment_method: "cash",
		version: 4,
		subtotal: 29000,
		discount_amount: 0,
		total: 29000,
		note: null,
		placed_at: "2026-11-28T03:00:00.000Z",
		accepted_at: "2026-11-28T03:00:00.000Z",
		preparing_at: null,
		done_at: null,
		completed_at: null,
		paid_at: "2026-11-28T03:01:00.000Z",
		cancelled_at: null,
		cancel_reason: null,
		lines: [],
		...overrides,
	};
}

function pill(overrides: Record<string, unknown> = {}) {
	return {
		order_id: ORDER,
		state: "pending",
		invoice: {
			id: INVOICE,
			kind: "sale",
			state: "queued",
			mode: null,
			invoice_no: null,
			series: null,
			lookup_code: null,
			lookup_url: null,
			tax_authority_code: null,
			amount: null,
			issued_at: null,
		},
		replacing: false,
		corrections_pending: 0,
		attempts: 0,
		next_attempt_at: null,
		request: null,
		...overrides,
	};
}

const REQUEST_JSON = {
	id: REQUEST,
	order_id: ORDER,
	source: "counter",
	status: "received",
	tax_code: "0312345678",
	company_name: "Công ty TNHH Mẫu",
	address: "12 Đường Mẫu",
	email: "ketoan@example.com",
	requested_at: "2026-11-28T03:02:00Z",
	issued_at: null,
	emailed_at: null,
	invoice: null,
};

function wrap(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider language="vi" catalogs={catalogs}>
				{children}
			</I18nProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	state.answers = [];
	state.failNext = false;
	state.calls = [];
	state.toasts = [];
});

afterEach(() => {
	cleanup();
});

describe("the pill (EP)", () => {
	it("has a tone for each state it shows and none for off and none", () => {
		expect(PILL_TONE).toEqual({
			pending: "neutral",
			issued: "positive",
			retrying: "warning",
			failed: "negative",
			cancelled: "neutral",
			off: null,
			none: null,
		});
	});

	it.each([
		["pending", "Đang xuất…", "Hóa đơn được xuất ngay sau khi nhận tiền."],
		["retrying", "Chưa xuất được", "Hệ thống tự thử lại, đơn vẫn hoàn tất."],
		["failed", "Không xuất được", "Đã dừng tự thử."],
		["cancelled", "Đã hủy", "Hóa đơn của đơn này đã hủy."],
	])("says %s in words: %s", async (pillState, words, line) => {
		state.answers = [pill({ state: pillState })];
		wrap(<EInvoiceCard order={order()} />);
		expect(await screen.findByTestId("einvoice-pill")).toHaveTextContent(words);
		expect(screen.getByTestId("einvoice-line")).toHaveTextContent(line);
	});

	it("says Đã xuất with the number, the time and the lookup code", async () => {
		state.answers = [
			pill({
				state: "issued",
				invoice: {
					...pill().invoice,
					state: "issued",
					mode: "sandbox",
					invoice_no: "000127",
					series: "C26MAA",
					lookup_code: "TC000127",
					amount: 29000,
					issued_at: "2026-11-28T07:07:00Z",
				},
			}),
		];
		wrap(<EInvoiceCard order={order()} />);
		expect(await screen.findByTestId("einvoice-pill")).toHaveTextContent(
			"Đã xuất",
		);
		expect(screen.getByTestId("einvoice-line")).toHaveTextContent(
			"Số 000127 · gửi cơ quan thuế lúc 14:07.",
		);
		expect(screen.getByTestId("einvoice-lookup")).toHaveTextContent(
			"Mã tra cứu TC000127",
		);
	});

	it("shows nothing for an unpaid order, and nothing when e-invoicing is off", async () => {
		wrap(<EInvoiceCard order={order({ payment_status: "unpaid" })} />);
		expect(screen.queryByTestId("einvoice-card")).toBeNull();
		expect(state.calls).toEqual([]);
		cleanup();
		state.answers = [pill({ state: "off", invoice: null })];
		wrap(<EInvoiceCard order={order({ source: "app" })} />);
		await waitFor(() => expect(state.calls).toHaveLength(1));
		expect(screen.queryByTestId("einvoice-card")).toBeNull();
	});

	it("shows a buyer's name as text, never as markup (error guessing)", async () => {
		state.answers = [
			pill({
				request: {
					...REQUEST_JSON,
					company_name: "<img src=x onerror=alert(1)>",
				},
			}),
		];
		wrap(<EInvoiceCard order={order()} />);
		const company = await screen.findByTestId("einvoice-company");
		expect(company).toHaveTextContent("<img src=x onerror=alert(1)> · MST");
		expect(company.querySelector("img")).toBeNull();
		expect(screen.queryByTestId("company-open")).toBeNull();
	});
});

describe("the company row (decision table)", () => {
	const none = { state: "pending", request: null } as const;
	it.each([
		["counter, paid, no request, on", order(), none, true],
		["app order", order({ source: "app" }), none, false],
		["unpaid", order({ payment_status: "unpaid" }), none, false],
		["refunded", order({ payment_status: "refunded" }), none, false],
		[
			"a request already",
			order(),
			{
				state: "pending",
				request: readCounterEInvoice(pill({ request: REQUEST_JSON })).request,
			},
			false,
		],
		["e-invoicing off", order(), { state: "off", request: null }, false],
		["nothing to invoice", order(), { state: "none", request: null }, false],
		["issued sale invoice", order(), { state: "issued", request: null }, true],
	] as const)("%s → %s", (_name, given, einvoice, open) => {
		expect(companyRowOpen(given, einvoice as never)).toBe(open);
	});

	it("stays closed before the e-invoice is read", () => {
		expect(companyRowOpen(order(), null)).toBe(false);
	});
});

describe("reading again (state transitions)", () => {
	it("goes on while the job may change it, and stops once settled", () => {
		const read = (overrides: Record<string, unknown>) =>
			readCounterEInvoice(pill(overrides));
		expect(stillMoving(undefined)).toBe(false);
		expect(stillMoving(read({ state: "pending" }))).toBe(true);
		expect(stillMoving(read({ state: "retrying" }))).toBe(true);
		expect(stillMoving(read({ state: "failed" }))).toBe(false);
		expect(stillMoving(read({ state: "issued" }))).toBe(false);
		expect(stillMoving(read({ state: "issued", request: REQUEST_JSON }))).toBe(
			true,
		);
		expect(
			stillMoving(
				read({
					state: "issued",
					request: { ...REQUEST_JSON, status: "emailed" },
				}),
			),
		).toBe(false);
	});

	it("refuses a malformed answer", () => {
		expect(() => readCounterEInvoice(pill({ state: "lost" }))).toThrow();
		expect(() => readCounterEInvoice({ ...pill(), order_id: 7 })).toThrow();
	});
});

describe("the words of the managers' list and the form", () => {
	it("word every error class, and an unknown one as unknown (EP)", () => {
		for (const name of [
			"timeout",
			"unavailable",
			"rate_limited",
			"rejected_auth",
			"not_configured",
			"rejected_data",
			"rejected_duplicate",
			"unsupported",
			"unknown",
		])
			expect(errorClassKey(name)).toBe(`einvoices.error.${name}`);
		expect(errorClassKey("cosmic_rays")).toBe("einvoices.error.unknown");
		expect(errorClassKey(null)).toBe("einvoices.error.unknown");
		expect(catalogs.vi[errorClassKey("rejected_data")]).toBe(
			"nhà cung cấp từ chối dữ liệu hóa đơn",
		);
	});

	it("retry only a failed document, and count the failing for the badge", () => {
		expect(retryable({ state: "failed" })).toBe(true);
		for (const other of [
			"queued",
			"issuing",
			"issued",
			"cancelled",
			"replaced",
		])
			expect(retryable({ state: other })).toBe(false);
		expect(attentionCount(undefined)).toBe(0);
		expect(
			attentionCount({
				failing: 3,
				gave_up: 1,
				pending: 9,
				emails_failing: 0,
				invoices: [],
			}),
		).toBe(3);
	});

	it("word each field's problem and each refusal", () => {
		expect(
			counterProblem({ field: "tax_code", kind: "digits", count: 9 }),
		).toEqual({
			key: "company.error.tax_code.digits",
			params: { count: 9 },
		});
		expect(
			counterProblem({ field: "address", kind: "line", max: 300 }).key,
		).toBe("company.error.text.line");
		expect(counterRefusalKey("not_counter_order")).toBe(
			"company.refusal.not_counter_order",
		);
		expect(counterRefusalKey("whatever")).toBe("company.refusal.other");
		for (const key of [
			"company.refusal.not_counter_order",
			"company.refusal.window_passed",
			"company.error.tax_code.characters",
		])
			expect(catalogs.vi[key]).toBeTruthy();
	});
});

describe("the company row's form (component)", () => {
	const fake = {
		rpc: async (fn: string, args: unknown) => {
			state.calls.push({ fn, args });
			if (state.failNext) {
				state.failNext = false;
				throw new TypeError("Failed to fetch");
			}
			return { data: state.answers.shift() ?? null, error: null };
		},
	} as never;
	const send =
		() =>
		(requestId: string, company: Parameters<typeof requestCompanyInvoice>[3]) =>
			requestCompanyInvoice(fake, ORDER, requestId, company);

	function fill(values: Record<string, string>) {
		for (const [name, value] of Object.entries(values)) {
			fireEvent.change(screen.getByTestId(`company-${name}`), {
				target: { value },
			});
			fireEvent.blur(screen.getByTestId(`company-${name}`));
		}
	}

	it("links every error to its field and focuses the first; nothing is sent", () => {
		wrap(
			<CompanyDialog
				orderNo="#042"
				onClose={vi.fn()}
				send={send()}
				onSent={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByTestId("company-submit"));
		for (const name of ["tax_code", "company_name", "address", "email"]) {
			const input = screen.getByTestId(`company-${name}`);
			const error = screen.getByTestId(`company-${name}-error`);
			expect(input).toHaveAttribute("aria-invalid", "true");
			expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
				error.id,
			);
		}
		expect(screen.getByTestId("company-tax_code")).toHaveFocus();
		expect(screen.getByTestId("company-message")).toHaveTextContent(
			"Còn 4 ô chưa đúng.",
		);
		fill({ tax_code: "031234567" });
		expect(screen.getByTestId("company-tax_code-error")).toHaveTextContent(
			"Mã số thuế gồm 10 hoặc 13 số. Đang nhập 9 số.",
		);
		// a text input drops a line break itself; a tab is a control character it keeps
		fill({ company_name: "Công ty\tMẫu", address: "<b>x</b>" });
		expect(screen.getByTestId("company-company_name-error")).toHaveTextContent(
			"Viết trên một dòng",
		);
		expect(screen.getByTestId("company-address-error")).toHaveTextContent(
			"Không dùng các ký tự < > { }.",
		);
		expect(state.calls).toEqual([]);
	});

	it("sends 13 bare digits hyphenated, once for a double tap; a lost answer is retried with the same id", async () => {
		const onSent = vi.fn();
		wrap(
			<CompanyDialog
				orderNo="#042"
				onClose={vi.fn()}
				send={send()}
				onSent={onSent}
			/>,
		);
		fill({
			tax_code: "0312345678001",
			company_name: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
		state.failNext = true;
		fireEvent.click(screen.getByTestId("company-submit"));
		fireEvent.click(screen.getByTestId("company-submit"));
		expect(await screen.findByTestId("company-message")).toHaveTextContent(
			"Không có mạng",
		);
		expect(state.calls).toHaveLength(1);
		state.answers = [
			{
				state: "received",
				refusal: null,
				replayed: true,
				request: REQUEST_JSON,
			},
		];
		fireEvent.click(screen.getByTestId("company-submit"));
		await waitFor(() => expect(onSent).toHaveBeenCalled());
		expect(state.calls).toHaveLength(2);
		const [first, second] = state.calls.map(
			(call) => (call.args as { p_request: { request_id: string } }).p_request,
		);
		expect(second?.request_id).toBe(first?.request_id);
		expect(state.calls[1]).toEqual({
			fn: "counter_request_invoice",
			args: {
				p_order: ORDER,
				p_request: {
					request_id: first?.request_id,
					company: {
						tax_code: "0312345678-001",
						company_name: "Công ty TNHH Mẫu",
						address: "12 Đường Mẫu",
						email: "ketoan@example.com",
					},
				},
			},
		});
	});

	it("marks the fields the server refused, and words a refusal", async () => {
		wrap(
			<CompanyDialog
				orderNo="#042"
				onClose={vi.fn()}
				send={send()}
				onSent={vi.fn()}
			/>,
		);
		fill({
			tax_code: "0312345678",
			company_name: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
		state.answers = [
			{
				state: "refused",
				refusal: "invalid",
				fields: ["email"],
				request: null,
			},
		];
		fireEvent.click(screen.getByTestId("company-submit"));
		expect(await screen.findByTestId("company-email-error")).toHaveTextContent(
			"Máy chủ chưa nhận ô này",
		);
		expect(screen.getByTestId("company-email")).toHaveFocus();
		state.answers = [
			{ state: "refused", refusal: "not_counter_order", request: null },
		];
		fill({ email: "ke.toan@example.com" });
		fireEvent.click(screen.getByTestId("company-submit"));
		expect(await screen.findByTestId("company-message")).toHaveTextContent(
			"khách tự xin hóa đơn công ty trong ứng dụng",
		);
	});

	it("holds a ticket's company without a call", () => {
		const onHold = vi.fn();
		wrap(<CompanyDialog orderNo="" onClose={vi.fn()} onHold={onHold} />);
		expect(screen.getByTestId("company-submit")).toHaveTextContent(
			"Giữ cho đơn này",
		);
		fill({
			tax_code: " 0312345678 ",
			company_name: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
		fireEvent.click(screen.getByTestId("company-submit"));
		expect(onHold).toHaveBeenCalledWith({
			taxCode: "0312345678",
			companyName: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
		expect(state.calls).toEqual([]);
	});
});
