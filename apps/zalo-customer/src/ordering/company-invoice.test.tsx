import type {
	EInvoicePill,
	InvoiceRequest,
	InvoiceStatus,
} from "@fnb/zalo-mini/ordering";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_FOREIGN_ORDER_ID, DEMO_ITEMS } from "../demo/ordering-fixtures";
import type { DemoTill } from "../demo/ordering-world";
import { renderOrderingApp } from "../test/render-ordering";
import {
	invoiceEntry,
	problemMessage,
	requestSteps,
	slowRequest,
	statusKey,
} from "./company-invoice";

// C18 Xin hóa đơn có mã số thuế công ty on the demo world (missing-screens README 5.7; docs/api.md 3.30), with the tests
// the design names (ISTQB):
// - C18-U (EP, BVA, DT): the words of each field's problem, the steps per request status (state transition), the
//   entry's decision table (eligible, requested, window passed, refused, unknown order), the slow provider;
// - C18-E1 (use case, state transitions): the order paid → the entry → the form (errors linked to their fields with
//   aria-describedby and aria-invalid, focus on the first) → the review (the tax code normalised, the warning) → "Đã
//   nhận yêu cầu" with its three steps → the read-only status as the job moves it (issued, emailed);
// - C18-I2 (error guessing): a double tap and a lost answer give one request (one request id per attempt);
// - C18-U4 (BVA): the window's day 7 (asked) and day 8 ("Đã quá hạn…"), as the server answers it;
// - saved companies: kept, offered as a chip, used, and deleted from "Dữ liệu của bạn" (C19), and the export's sections;
// - security (C18-S1, S2, S4): another customer's order is "Không tìm thấy", markup and CRLF are refused before any
//   call and shown as text when they come back, no tax data in the address or a console line.

const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const TAX = "0312345678";
const COMPANY = "Công ty TNHH Thương mại Mẫu";
const ADDRESS = "12 Đường Mẫu, Phường Bến Nghé, Quận 1";
const EMAIL = "ketoan@example.com";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function placeAndPay(till: DemoTill): Promise<string> {
	const row = (await screen.findAllByTestId("menu-item")).find(
		(element) =>
			element.getAttribute("data-item-id") === DEMO_ITEMS.blackCoffee,
	);
	if (row === undefined) throw new Error("no black coffee");
	fireEvent.click(
		within(row).getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }),
	);
	fireEvent.click(
		within(await screen.findByTestId("cart-bar")).getByRole("button"),
	);
	fireEvent.click(await screen.findByTestId("cart-continue"));
	const submit = await screen.findByTestId("checkout-submit");
	await waitFor(() => expect(submit).toBeEnabled());
	fireEvent.click(submit);
	await screen.findByTestId("order");
	expect(screen.queryByTestId("order-invoice")).toBeNull();
	till.act("pay");
	await screen.findByTestId("order-invoice-ask", {}, { timeout: 8000 });
	return till.latestOrder() ?? "";
}

function field(name: string): HTMLInputElement {
	return screen.getByTestId(`invoice-${name}`) as HTMLInputElement;
}

function type(name: string, value: string) {
	fireEvent.change(field(name), { target: { value } });
	fireEvent.blur(field(name));
}

function fill(values: {
	readonly tax?: string;
	readonly name?: string;
	readonly address?: string;
	readonly email?: string;
}) {
	type("tax_code", values.tax ?? TAX);
	type("company_name", values.name ?? COMPANY);
	type("address", values.address ?? ADDRESS);
	type("email", values.email ?? EMAIL);
}

function expectLinkedError(name: string, words: string | RegExp) {
	const input = field(name);
	const error = screen.getByTestId(`invoice-${name}-error`);
	expect(error).toHaveTextContent(words);
	expect(input).toHaveAttribute("aria-invalid", "true");
	expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(
		error.id,
	);
}

const REQUEST: InvoiceRequest = {
	id: "66666666-0000-4000-8000-000000000001",
	orderId: "99999999-0000-4000-8000-000000000002",
	source: "app",
	status: "received",
	taxCode: TAX,
	companyName: COMPANY,
	address: ADDRESS,
	email: EMAIL,
	requestedAt: "2026-11-27T07:21:00Z",
	issuedAt: null,
	emailedAt: null,
	invoice: null,
};

const PILL: EInvoicePill = {
	state: "pending",
	invoice: null,
	replacing: false,
	correctionsPending: 0,
	attempts: 0,
	nextAttemptAt: null,
};

function known(overrides: Partial<InvoiceStatus & { state: "known" }>) {
	return {
		state: "known",
		orderId: REQUEST.orderId,
		displayNo: "#002",
		paidAt: "2026-11-20T07:00:00Z",
		total: 29000,
		eligible: true,
		refusal: null,
		windowDays: 7,
		lastDay: "2026-11-27",
		request: null,
		einvoice: PILL,
		...overrides,
	} as InvoiceStatus;
}

describe("C18-U the screen's rules", () => {
	it("word each field's problem with its values (EP)", () => {
		expect(
			problemMessage({ field: "tax_code", kind: "digits", count: 8 }),
		).toEqual({ key: "invoice.error.tax_code.digits", params: { count: 8 } });
		expect(
			problemMessage({ field: "company_name", kind: "too_long", max: 200 }),
		).toEqual({ key: "invoice.error.text.too_long", params: { max: 200 } });
		expect(
			problemMessage({ field: "address", kind: "empty", max: 300 }).key,
		).toBe("invoice.error.address.empty");
		expect(problemMessage({ field: "email", kind: "format" }).key).toBe(
			"invoice.error.email.format",
		);
	});

	it("draw the three steps per status (state transitions)", () => {
		const states = (status: InvoiceRequest["status"]) =>
			requestSteps({ ...REQUEST, status }).map((step) => step.state);
		expect(states("received")).toEqual(["done", "current", "todo"]);
		expect(states("issuing")).toEqual(["done", "current", "todo"]);
		expect(states("issued")).toEqual(["done", "done", "current"]);
		expect(states("emailed")).toEqual(["done", "done", "done"]);
		expect(states("failed")).toEqual(["done", "current", "todo"]);
		expect(states("cancelled")).toEqual(["done", "todo", "todo"]);
	});

	it("call a request slow when the provider keeps failing before it is issued", () => {
		expect(slowRequest(REQUEST, PILL)).toBe(false);
		expect(slowRequest(REQUEST, { ...PILL, state: "retrying" })).toBe(true);
		expect(slowRequest(REQUEST, { ...PILL, state: "failed" })).toBe(true);
		expect(slowRequest({ ...REQUEST, status: "failed" }, PILL)).toBe(true);
		expect(
			slowRequest(
				{ ...REQUEST, status: "issued" },
				{ ...PILL, state: "failed" },
			),
		).toBe(false);
		expect(statusKey({ ...REQUEST, status: "failed" }, PILL)).toBe(
			"invoice.status.slow",
		);
	});

	it("offer the entry by the server's answer (decision table)", () => {
		expect(invoiceEntry(known({}))).toEqual({
			kind: "ask",
			lastDay: "2026-11-27",
		});
		expect(
			invoiceEntry(
				known({
					eligible: false,
					refusal: "already_requested",
					request: REQUEST,
				}),
			),
		).toEqual({ kind: "requested", request: REQUEST });
		expect(
			invoiceEntry(known({ eligible: false, refusal: "window_passed" })),
		).toEqual({ kind: "late" });
		for (const refusal of [
			"einvoice_off",
			"not_paid",
			"refunded",
			"nothing_to_invoice",
		] as const)
			expect(invoiceEntry(known({ eligible: false, refusal }))).toBeNull();
		expect(
			invoiceEntry({ state: "unknown_order", orderId: REQUEST.orderId }),
		).toBeNull();
	});
});

describe("C18-E1 asking for a company invoice", () => {
	it("goes from the paid order through the form, its errors and the review to the request received, once", async () => {
		const logs = [
			vi.spyOn(console, "log"),
			vi.spyOn(console, "info"),
			vi.spyOn(console, "warn"),
			vi.spyOn(console, "error"),
		];
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeAndPay(till);
		expect(screen.getByTestId("order-invoice-line")).toHaveTextContent(
			/Xin hóa đơn có mã số thuế công ty đến hết ngày \d\d\/\d\d\/\d{4}\./,
		);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		expect(await screen.findByTestId("company-invoice-form")).toBeVisible();
		expect(screen.getByTestId("invoice-order")).toHaveTextContent(
			/Đơn #\d{3} · \d\d\/\d\d\/\d{4}/,
		);
		// nothing typed: every field says what it needs, linked to its input, and the tax code takes the focus
		fireEvent.click(screen.getByTestId("invoice-review"));
		expectLinkedError("tax_code", "Nhập mã số thuế của công ty.");
		expectLinkedError("company_name", "Nhập tên công ty.");
		expectLinkedError("address", "Nhập địa chỉ của công ty.");
		expectLinkedError("email", "Nhập email nhận hóa đơn.");
		expect(document.activeElement).toBe(field("tax_code"));
		expect(screen.getByTestId("invoice-problem")).toHaveTextContent(
			"Còn 4 ô chưa đúng",
		);
		expect(screen.queryByTestId("company-invoice-review")).toBeNull();
		// BVA of the tax code as the design draws it: 8 digits, then 13 bare digits (normalised)
		type("tax_code", "03123456");
		expectLinkedError(
			"tax_code",
			"Mã số thuế gồm 10 hoặc 13 số. Bạn đang nhập 8 số.",
		);
		type("email", "ketoan@example");
		expectLinkedError(
			"email",
			"Email chưa đúng. Kiểm tra lại phần trước và sau dấu @.",
		);
		fill({ tax: " 0312345678001 " });
		expect(field("tax_code")).toHaveAttribute("aria-invalid", "false");
		expect(screen.queryByTestId("invoice-tax_code-error")).toBeNull();
		fireEvent.click(screen.getByTestId("invoice-review"));
		const review = await screen.findByTestId("company-invoice-review");
		expect(screen.getByTestId("invoice-title")).toHaveTextContent(
			"Kiểm tra lại",
		);
		expect(
			within(review).getByTestId("invoice-value-tax_code"),
		).toHaveTextContent("0312345678-001 đúng định dạng");
		expect(screen.getByTestId("invoice-immutable")).toHaveTextContent(
			"Hóa đơn không sửa được sau khi xuất.",
		);
		// a double tap sends one request
		const send = screen.getByTestId("invoice-send");
		fireEvent.click(send);
		fireEvent.click(send);
		const status = await screen.findByTestId("company-invoice-status");
		expect(till.invoiceRequests()).toBe(1);
		expect(status).toHaveAttribute("data-fresh", "true");
		expect(
			screen.getByRole("heading", { name: "Đã nhận yêu cầu" }),
		).toHaveFocus();
		expect(screen.getByTestId("invoice-received-body")).toHaveTextContent(
			`Quán xuất hóa đơn tên ${COMPANY} và gửi tới ${EMAIL}.`,
		);
		expect(
			screen
				.getAllByTestId("invoice-step")
				.map((step) => step.getAttribute("data-state")),
		).toEqual(["done", "current", "todo"]);
		expect(screen.getByTestId("invoice-replaces")).toHaveTextContent(
			"Quán không xuất hai hóa đơn cho một đơn.",
		);
		// security: no tax data in the address or any console line
		expect(window.location.href).not.toContain(TAX);
		for (const spy of logs)
			for (const call of spy.mock.calls)
				expect(JSON.stringify(call)).not.toMatch(/0312345678|ketoan@/);
	}, 40_000);

	it("shows the request read only as the job moves it, and a slow provider", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeAndPay(till);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		await screen.findByTestId("company-invoice-form");
		fill({});
		fireEvent.click(screen.getByTestId("invoice-review"));
		fireEvent.click(await screen.findByTestId("invoice-send"));
		await screen.findByTestId("company-invoice-status");
		// the provider keeps failing the sale invoice: "slower than expected"
		till.einvoice("retrying");
		fireEvent.click(screen.getByTestId("invoice-to-orders"));
		fireEvent.click(
			(await screen.findAllByTestId("order-row"))[0] as HTMLElement,
		);
		const view = await screen.findByTestId(
			"order-invoice-view",
			{},
			{ timeout: 8000 },
		);
		expect(screen.getByTestId("order-invoice-line")).toHaveTextContent(
			"Chậm hơn dự kiến, quán đang xử lý",
		);
		fireEvent.click(view);
		const status = await screen.findByTestId("company-invoice-status");
		expect(status).toHaveAttribute("data-fresh", "false");
		expect(screen.getByTestId("invoice-slow")).toHaveTextContent(
			"Chậm hơn dự kiến, quán đang xử lý.",
		);
		expect(
			screen.getByRole("heading", {
				name: "Bạn đã xin hóa đơn công ty cho đơn này",
			}),
		).toBeVisible();
		expect(screen.getByTestId("invoice-value-company_name")).toHaveTextContent(
			COMPANY,
		);
		expect(screen.queryByTestId("company-invoice-form")).toBeNull();
		// the job issues and emails it: every step done
		till.einvoice("issued");
		till.companyInvoice("emailed");
		fireEvent.click(screen.getByTestId("invoice-to-orders"));
		fireEvent.click(
			(await screen.findAllByTestId("order-row"))[0] as HTMLElement,
		);
		fireEvent.click(
			await screen.findByTestId("order-invoice-view", {}, { timeout: 8000 }),
		);
		await waitFor(() =>
			expect(
				screen
					.getAllByTestId("invoice-step")
					.map((step) => step.getAttribute("data-state")),
			).toEqual(["done", "done", "done"]),
		);
		expect(screen.queryByTestId("invoice-slow")).toBeNull();
	}, 40_000);
});

describe("C18-U4 the window, as the server answers it (BVA)", () => {
	it("day 7 after the payment still asks; day 8 says it is too late", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		const order = await placeAndPay(till);
		till.paidDaysAgo(7, order);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		expect(await screen.findByTestId("company-invoice-form")).toBeVisible();
		till.paidDaysAgo(8, order);
		fill({});
		fireEvent.click(screen.getByTestId("invoice-review"));
		fireEvent.click(await screen.findByTestId("invoice-send"));
		expect(await screen.findByTestId("invoice-late")).toHaveTextContent(
			"Đã quá hạn xin hóa đơn cho đơn này, bạn hỏi nhân viên ở quầy giúp.",
		);
		expect(till.invoiceRequests()).toBe(0);
	}, 40_000);
});

describe("C18-S security", () => {
	it("answers another customer's order with not found and nothing else (IDOR)", async () => {
		renderOrderingApp({
			search: `?route=/hoa-don-cong-ty/${DEMO_FOREIGN_ORDER_ID}`,
		});
		expect(await screen.findByTestId("invoice-missing-note")).toHaveTextContent(
			"Không tìm thấy đơn này.",
		);
		expect(screen.queryByTestId("company-invoice-form")).toBeNull();
	});

	it("treats a hand-made id as an unknown order", async () => {
		renderOrderingApp({ search: "?route=/hoa-don-cong-ty/not-an-order-id" });
		expect(await screen.findByTestId("invoice-missing-note")).toBeVisible();
	});

	it("refuses markup, template braces and a CRLF before any call", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeAndPay(till);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		await screen.findByTestId("company-invoice-form");
		fill({
			name: "<script>alert(1)</script>",
			address: "{{ constructor.constructor('x')() }}",
			email: "ketoan@example.com\r\nBcc: x@example.com",
		});
		expectLinkedError("company_name", "Không dùng các ký tự < > { }.");
		expectLinkedError("address", "Không dùng các ký tự < > { }.");
		expectLinkedError("email", "Email chưa đúng");
		fireEvent.click(screen.getByTestId("invoice-review"));
		expect(screen.queryByTestId("company-invoice-review")).toBeNull();
		expect(document.querySelector("script:not([src])")).toBeNull();
		expect(till.invoiceRequests()).toBe(0);
	}, 40_000);

	it("says why when e-invoicing is off at the store, and offers nothing on the order", async () => {
		const { till } = renderOrderingApp({
			search: `${TABLE}&einvoice=off`,
			settings: { einvoiceOff: true },
		});
		await screen.findByTestId("ordering-menu");
		const row = (await screen.findAllByTestId("menu-item")).find(
			(element) =>
				element.getAttribute("data-item-id") === DEMO_ITEMS.blackCoffee,
		);
		fireEvent.click(
			within(row as HTMLElement).getByRole("button", {
				name: "Thêm Cà phê đen vào giỏ",
			}),
		);
		fireEvent.click(
			within(await screen.findByTestId("cart-bar")).getByRole("button"),
		);
		fireEvent.click(await screen.findByTestId("cart-continue"));
		const submit = await screen.findByTestId("checkout-submit");
		await waitFor(() => expect(submit).toBeEnabled());
		fireEvent.click(submit);
		await screen.findByTestId("order");
		till.act("pay");
		await waitFor(
			() =>
				expect(screen.getByTestId("order")).toHaveAttribute(
					"data-payment",
					"paid",
				),
			{ timeout: 8000 },
		);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(screen.queryByTestId("order-invoice")).toBeNull();
	}, 40_000);
});

describe("saved companies (C18, C19)", () => {
	it("are kept, offered as a chip for the next order, and deleted from Dữ liệu của bạn", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		till.saveCompany({
			tax_code: "0312345678-001",
			company_name: "Chi nhánh Mẫu",
			address: ADDRESS,
			email: EMAIL,
		});
		await placeAndPay(till);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		const chips = await screen.findByTestId("invoice-companies");
		const chip = within(chips).getByRole("button", {
			name: "Chi nhánh Mẫu · 0312345678-001",
		});
		expect(
			within(chips).getByRole("button", { name: "Công ty mới" }),
		).toHaveAttribute("aria-pressed", "true");
		fireEvent.click(chip);
		expect(chip).toHaveAttribute("aria-pressed", "true");
		expect(field("tax_code")).toHaveValue("0312345678-001");
		expect(screen.queryByTestId("invoice-save")).toBeNull();
		fireEvent.click(screen.getByTestId("invoice-review"));
		fireEvent.click(await screen.findByTestId("invoice-send"));
		await screen.findByTestId("company-invoice-status");
		expect(till.invoiceRequests()).toBe(1);
		expect(screen.getByTestId("invoice-received-body")).toHaveTextContent(
			"Quán xuất hóa đơn tên Chi nhánh Mẫu",
		);
	}, 40_000);

	it("can be deleted from Dữ liệu của bạn after a request kept one", async () => {
		const { till } = renderOrderingApp({ search: TABLE });
		await screen.findByTestId("ordering-menu");
		await placeAndPay(till);
		fireEvent.click(screen.getByTestId("order-invoice-ask"));
		await screen.findByTestId("company-invoice-form");
		fill({});
		expect(screen.getByTestId("invoice-save")).toBeChecked();
		fireEvent.click(screen.getByTestId("invoice-review"));
		fireEvent.click(await screen.findByTestId("invoice-send"));
		await screen.findByTestId("company-invoice-status");
		// whatever the server answers is shown as text, never as markup
		till.saveCompany({
			tax_code: "0399999999",
			company_name: "<img src=x onerror=alert(1)>",
			address: ADDRESS,
			email: EMAIL,
		});
		fireEvent.click(screen.getByTestId("invoice-to-orders"));
		fireEvent.click(
			within(await screen.findByRole("navigation")).getByText("Tôi", {
				exact: true,
			}),
		);
		fireEvent.click(
			(await screen.findAllByTestId("account-row")).find(
				(row) => row.getAttribute("data-row") === "data",
			) as HTMLElement,
		);
		await screen.findAllByTestId("saved-company");
		const hostile = screen
			.getAllByTestId("saved-company")
			.find((entry) => entry.textContent?.includes("onerror")) as HTMLElement;
		expect(hostile).toHaveTextContent("<img src=x onerror=alert(1)>");
		expect(
			screen.getByTestId("saved-companies").querySelector("img"),
		).toBeNull();
		const row = screen
			.getAllByTestId("saved-company")
			.find((entry) => entry.textContent?.includes(COMPANY)) as HTMLElement;
		expect(row).toHaveTextContent(COMPANY);
		expect(row).toHaveTextContent(`MST ${TAX} · ${EMAIL}`);
		fireEvent.click(
			within(row).getByRole("button", { name: `Xóa công ty ${COMPANY}` }),
		);
		expect(screen.getByTestId("saved-company-confirm")).toHaveTextContent(
			"Yêu cầu hóa đơn đã gửi với công ty này vẫn giữ nguyên.",
		);
		fireEvent.click(await screen.findByTestId("saved-company-confirm-delete"));
		expect(
			await screen.findByTestId("saved-companies-message"),
		).toHaveTextContent("Đã xóa công ty.");
		await waitFor(() =>
			expect(screen.getAllByTestId("saved-company")).toHaveLength(1),
		);
		expect(screen.getByTestId("saved-companies")).not.toHaveTextContent(
			COMPANY,
		);
		// the export names the two new sections and their fields in words
		fireEvent.click(screen.getByTestId("data-export"));
		fireEvent.click(await screen.findByTestId("data-export-load"));
		const view = await screen.findByTestId("data-export-view");
		const requests = within(view)
			.getByText("Yêu cầu hóa đơn công ty")
			.closest("section") as HTMLElement;
		expect(requests).toHaveTextContent("Mã số thuế");
		expect(requests).toHaveTextContent(TAX);
		expect(within(view).getByText("Công ty đã lưu")).toBeVisible();
	}, 40_000);
});
