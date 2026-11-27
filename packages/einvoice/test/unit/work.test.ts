import { describe, expect, it } from "vitest";
import {
	composeInvoiceMail,
	createEInvoiceProvider,
	createMockMailer,
	createMockProvider,
	EInvoiceConfigError,
	type EInvoiceProvider,
	emailResultRequest,
	errorClassOf,
	MailError,
	MockLedger,
	readEInvoiceProviderConfig,
	readEmailItem,
	readWorkItem,
	resultRequest,
	runEmailItem,
	runWorkItem,
	type WorkItem,
} from "../../src/index.js";

// einvoice:unit/work — the job's decision for one document, as the database's work list hands it over
// (app.einvoice_job_item): reading the item and the provider row (equivalence classes of malformed answers), the first
// attempt and the later one that asks first (a provider timeout never makes a second invoice), a cancellation the
// provider refuses becoming an adjustment to zero, nothing to send, every failure by class only; and the company
// invoice email, escaped and refused when a header would break. Techniques: decision table (query_first x found x
// amount x action), state transitions, error guessing (C18-S2).

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const CLAIM = "99999999-9999-4999-8999-999999999999";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const KEY = "synthetic-einvoice-key";
const AT = new Date("2026-11-25T03:00:00.000Z");

const providerRow = {
	id: PROVIDER_ID,
	brand_id: "55555555-5555-4555-8555-555555555555",
	store_id: null,
	adapter: "mock",
	mode: "sandbox",
	secret_name: "EINVOICE_KEY_BRAND_1",
	settings: {
		seller_tax_code: "0312345678",
		template: "2",
		series: "C26MAA",
		vat_rate: "none",
	},
};

function saleRow(extra: Record<string, unknown> = {}) {
	return {
		invoice_id: ID,
		claim: CLAIM,
		kind: "sale",
		action: "issue",
		reason: "paid",
		query_first: false,
		amount: 29000,
		currency: "VND",
		sold_at: "2026-11-25T03:00:00+00:00",
		order: {
			id: "66666666-6666-4666-8666-666666666666",
			display_no: "#001",
			business_date: "2026-11-25",
			store_name: "Cửa hàng mẫu",
		},
		lines: [
			{ name: "Cà phê sữa", quantity: 1, unit_price: 29000, amount: 29000 },
		],
		payment_methods: ["cash"],
		buyer: null,
		original: null,
		provider: providerRow,
		...extra,
	};
}

function item(extra: Record<string, unknown> = {}): WorkItem {
	const read = readWorkItem(saleRow(extra));
	if (read === null) {
		throw new Error("the fixture item is out of shape");
	}
	return read;
}

function mock(
	ledger: MockLedger,
	extra: Parameters<typeof createMockProvider>[0] extends infer O
		? Partial<O>
		: never = {},
): EInvoiceProvider {
	return createMockProvider({ secret: KEY, mode: "sandbox", ledger, ...extra });
}

describe("reading the provider row and the work item", () => {
	it("reads a complete row and refuses every malformed class", () => {
		expect(readEInvoiceProviderConfig(providerRow)?.seller.series).toBe(
			"C26MAA",
		);
		for (const broken of [
			{ ...providerRow, id: "x" },
			{ ...providerRow, mode: "on" },
			{ ...providerRow, secret_name: "PAYMENT_BANK_BRAND_1" },
			{
				...providerRow,
				settings: { ...providerRow.settings, series: "C26TAA" },
			},
			{ ...providerRow, settings: { ...providerRow.settings, vat_rate: 10 } },
			null,
			[],
		]) {
			expect(readEInvoiceProviderConfig(broken)).toBeNull();
		}
	});

	it("makes the mock only in sandbox where mocks are allowed, with a key", () => {
		const config = readEInvoiceProviderConfig(providerRow);
		if (config === null) throw new Error("fixture");
		expect(
			createEInvoiceProvider(config, { secret: KEY, allowMock: true }).adapter,
		).toBe("mock");
		expect(() =>
			createEInvoiceProvider(config, { secret: KEY, allowMock: false }),
		).toThrow(EInvoiceConfigError);
		expect(() =>
			createEInvoiceProvider(
				{ ...config, mode: "live" },
				{ secret: KEY, allowMock: true },
			),
		).toThrow(EInvoiceConfigError);
		expect(() =>
			createEInvoiceProvider(
				{ ...config, mode: "off" },
				{ secret: KEY, allowMock: true },
			),
		).toThrow(EInvoiceConfigError);
		expect(() =>
			createEInvoiceProvider(config, { secret: "", allowMock: true }),
		).toThrow(EInvoiceConfigError);
		expect(() =>
			createEInvoiceProvider(
				{ ...config, adapter: "easyinvoice" },
				{ secret: KEY, allowMock: true },
			),
		).toThrow(EInvoiceConfigError);
		expect(errorClassOf(new EInvoiceConfigError("x"))).toBe("not_configured");
		expect(errorClassOf(new Error("Nguyen Van A 0312345678"))).toBe("unknown");
	});

	it("reads the database's item and refuses its malformed classes", () => {
		expect(item()).toMatchObject({
			invoiceId: ID,
			action: "issue",
			amount: 29000,
			orderLabel: "#001",
			buyer: null,
		});
		for (const broken of [
			saleRow({ claim: "not-a-uuid" }),
			saleRow({ kind: "refund" }),
			saleRow({ action: "delete" }),
			saleRow({ amount: 29000.5 }),
			saleRow({ query_first: "yes" }),
			saleRow({ payment_methods: ["bitcoin"] }),
			saleRow({
				lines: [{ name: "x", quantity: "1", unit_price: 1, amount: 1 }],
			}),
			saleRow({ kind: "replacement", action: "replace" }),
			saleRow({ kind: "adjustment", action: "adjust", amount: -1000 }),
			saleRow({ provider: { ...providerRow, secret_name: "x" } }),
		]) {
			expect(readWorkItem(broken)).toBeNull();
		}
	});
});

describe("running one document", () => {
	it("issues a sale invoice the first time and reports it", async () => {
		const ledger = new MockLedger();
		const result = await runWorkItem(item(), mock(ledger), AT);
		expect(result.outcome).toBe("issued");
		expect(resultRequest(item(), result)).toMatchObject({
			kind: "invoice",
			invoice_id: ID,
			claim: CLAIM,
			outcome: "issued",
			action: "issue",
			amount: 29000,
		});
		expect(ledger.calls).toEqual(["issue"]);
	});

	it("after a lost answer, asks first and records the invoice the provider made: never a second one", async () => {
		const ledger = new MockLedger();
		const provider = mock(ledger, {
			script: [{ operation: "issue", failure: "timeout", afterWork: true }],
		});
		const first = await runWorkItem(item(), provider, AT);
		expect(first).toEqual({ outcome: "failed", errorClass: "timeout" });
		const second = await runWorkItem(item({ query_first: true }), provider, AT);
		expect(second.outcome).toBe("issued");
		expect(ledger.calls).toEqual(["issue", "query"]);
		expect(ledger.documents.size).toBe(1);
	});

	it("asks first and makes the invoice when the provider never got the first attempt", async () => {
		const ledger = new MockLedger();
		const result = await runWorkItem(
			item({ query_first: true }),
			mock(ledger),
			AT,
		);
		expect(result.outcome).toBe("issued");
		expect(ledger.calls).toEqual(["query", "issue"]);
	});

	it("reports not_found when asked again with nothing left to invoice and nothing made", async () => {
		const ledger = new MockLedger();
		expect(
			await runWorkItem(
				item({ query_first: true, amount: 0 }),
				mock(ledger),
				AT,
			),
		).toEqual({ outcome: "not_found" });
		expect(await runWorkItem(item({ amount: 0 }), mock(ledger), AT)).toEqual({
			outcome: "failed",
			errorClass: "rejected_data",
		});
		expect(ledger.documents.size).toBe(0);
	});

	it("reports a refusal and an outage by class, never by text", async () => {
		const ledger = new MockLedger();
		expect(
			await runWorkItem(
				item({ lines: [{ name: "x", quantity: 1, unit_price: 1, amount: 1 }] }),
				mock(ledger),
				AT,
			),
		).toEqual({
			outcome: "failed",
			errorClass: "rejected_data",
		});
		expect(
			await runWorkItem(
				item(),
				mock(ledger, {
					script: [{ operation: "issue", failure: "rate_limited" }],
				}),
				AT,
			),
		).toEqual({
			outcome: "failed",
			errorClass: "rate_limited",
		});
		expect(
			resultRequest(item(), { outcome: "failed", errorClass: "rate_limited" }),
		).toEqual({
			kind: "invoice",
			invoice_id: ID,
			claim: CLAIM,
			outcome: "failed",
			error_class: "rate_limited",
		});
	});

	async function issuedOriginal(ledger: MockLedger) {
		const issued = await mock(ledger).issue({
			invoiceId: ID,
			soldAt: AT.toISOString(),
			amount: 29000,
			seller: {
				sellerTaxCode: "0312345678",
				template: "2",
				series: "C26MAA",
				vatRate: "none",
			},
			buyer: null,
			lines: [
				{ name: "Cà phê sữa", quantity: 1, unitPrice: 29000, amount: 29000 },
			],
			paymentMethods: ["cash"],
			orderLabel: "#001",
			storeName: "Cửa hàng mẫu",
		});
		return {
			invoice_id: ID,
			provider_ref: issued.providerRef,
			invoice_no: issued.invoiceNo,
			series: issued.series,
			issued_at: issued.issuedAt,
			amount: 29000,
		};
	}

	it("replaces the sale invoice with the company invoice", async () => {
		const ledger = new MockLedger();
		const original = await issuedOriginal(ledger);
		const buyer = {
			tax_code: "0312345678-001",
			company_name: "Công ty Bếp",
			address: "12 Đường Số 3",
			email: "hd@example.com",
		};
		const result = await runWorkItem(
			item({
				invoice_id: ID2,
				kind: "replacement",
				action: "replace",
				buyer,
				original,
			}),
			mock(ledger),
			AT,
		);
		expect(result.outcome === "issued" && result.invoice.operation).toBe(
			"replace",
		);
		expect(ledger.documents.get(ID)?.state).toBe("replaced");
	});

	it("adjusts by a refund, and turns a refused cancellation into an adjustment to zero", async () => {
		const ledger = new MockLedger();
		const original = await issuedOriginal(ledger);
		const adjust = await runWorkItem(
			item({
				invoice_id: ID2,
				kind: "adjustment",
				action: "adjust",
				amount: -10000,
				lines: [],
				original,
			}),
			mock(ledger),
			AT,
		);
		expect(
			adjust.outcome === "issued" && [
				adjust.invoice.operation,
				adjust.invoice.amount,
			],
		).toEqual(["adjust", -10000]);
		const cancel = await runWorkItem(
			item({
				invoice_id: "77777777-7777-4777-8777-777777777777",
				kind: "cancellation",
				action: "cancel",
				amount: -19000,
				lines: [],
				original: { ...original, amount: 19000 },
			}),
			mock(ledger),
			AT,
		);
		expect(
			cancel.outcome === "issued" && [
				cancel.invoice.operation,
				cancel.invoice.amount,
			],
		).toEqual(["adjust", -19000]);
		expect(ledger.calls.slice(-2)).toEqual(["cancel", "adjust"]);
	});

	it("cancels where the provider cancels", async () => {
		const ledger = new MockLedger();
		const original = await issuedOriginal(ledger);
		const cancel = await runWorkItem(
			item({
				invoice_id: ID2,
				kind: "cancellation",
				action: "cancel",
				amount: -29000,
				lines: [],
				original,
			}),
			mock(ledger, { cancelSupported: true }),
			AT,
		);
		expect(cancel.outcome === "issued" && cancel.invoice.operation).toBe(
			"cancel",
		);
		expect(ledger.documents.get(ID)?.state).toBe("cancelled");
	});
});

describe("the company invoice email", () => {
	const emailRow = {
		request_id: ID,
		to: "ke.toan@example.com",
		company_name: 'Công ty A & B "Số 1"',
		tax_code: "0312345678-001",
		order_display_no: "#007",
		store_name: "Cửa hàng mẫu",
		invoice: {
			invoice_no: "00000002",
			series: "2C26MAA",
			lookup_code: "ZEDALU99BE",
			lookup_url: "https://einvoice.mock.invalid/tra-cuu/ZEDALU99BE",
			amount: 29000,
		},
	};

	it("is composed with every value escaped for HTML", () => {
		const email = readEmailItem(emailRow);
		if (email === null) throw new Error("fixture");
		const mail = composeInvoiceMail(email);
		expect(mail.subject).toBe("Hóa đơn điện tử đơn #007 – Cửa hàng mẫu");
		expect(mail.html).toContain("Công ty A &amp; B &quot;Số 1&quot;");
		expect(mail.html).not.toContain('"Số 1"');
		expect(mail.text).toContain("Tổng tiền: 29.000đ");
		expect(mail.text).toContain("Mã tra cứu: ZEDALU99BE");
	});

	it("is refused when a header would break or the address is not one", () => {
		const email = readEmailItem(emailRow);
		if (email === null) throw new Error("fixture");
		expect(() =>
			composeInvoiceMail({
				...email,
				storeName: "Cửa hàng\r\nBcc: x@example.org",
			}),
		).toThrow(MailError);
		expect(() =>
			composeInvoiceMail({
				...email,
				to: "a@example.com\r\nBcc: x@example.org",
			}),
		).toThrow(MailError);
		expect(readEmailItem({ ...emailRow, request_id: "x" })).toBeNull();
	});

	it("goes through the mock mailer, and answers by class when it cannot", async () => {
		const email = readEmailItem(emailRow);
		if (email === null) throw new Error("fixture");
		const mailer = createMockMailer();
		expect(await runEmailItem(email, mailer)).toEqual({ ok: true });
		expect(mailer.sent).toHaveLength(1);
		expect(await runEmailItem(email, null)).toEqual({
			ok: false,
			errorClass: "no_mailer",
		});
		expect(
			await runEmailItem(email, createMockMailer({ failWith: "timeout" })),
		).toEqual({ ok: false, errorClass: "timeout" });
		expect(
			await runEmailItem({ ...email, to: "not-an-address" }, mailer),
		).toEqual({ ok: false, errorClass: "rejected" });
		expect(
			emailResultRequest(email, { ok: false, errorClass: "timeout" }),
		).toEqual({
			kind: "email",
			request_id: ID,
			ok: false,
			error_class: "timeout",
		});
	});
});
