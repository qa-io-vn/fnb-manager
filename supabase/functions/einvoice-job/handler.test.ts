import { createMockMailer, MockLedger } from "@fnb/einvoice";
import {
	assert,
	assertEquals,
	fakeBackend,
} from "../_shared/payments-fakes.ts";
import { handleEInvoiceJob } from "./handler.ts";

// einvoice-job: the ticket gate, then each kind of work against the mock provider: a sale invoice issued and reported
// under its claim; a lost answer (the provider made the invoice) then a later run that asks first and records it, with
// one document at the provider (no duplicate); a refused cancellation turned into an adjustment to zero; the mock refused
// where EINVOICE_MOCK is not on and a missing key, both not_configured; a malformed document reported for a person; the
// company invoice email through the mock mailer, and no_mailer without one; and a log without any buyer data.

const URL_ = "http://127.0.0.1:54321/functions/v1/einvoice-job";
const TICKET = "77777777-7777-4777-8777-777777777777";
const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const ADJUST_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM = "99999999-9999-4999-8999-999999999999";
const KEY = "synthetic-einvoice-key-for-tests";
const ENVIRONMENT = { EINVOICE_KEY_BRAND_1: KEY, EINVOICE_MOCK: "on" };
const BUYER_TAX = "0312345678-001";
const BUYER_NAME = "Công ty TNHH Bếp Nhà Mẫu";
const BUYER_EMAIL = "ke.toan@example.com";

const providerRow = {
	id: "44444444-4444-4444-8444-444444444444",
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

function sale(extra: Record<string, unknown> = {}) {
	return {
		invoice_id: INVOICE_ID,
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

const email = {
	request_id: REQUEST_ID,
	to: BUYER_EMAIL,
	company_name: BUYER_NAME,
	tax_code: BUYER_TAX,
	order_display_no: "#001",
	store_name: "Cửa hàng mẫu",
	invoice: {
		invoice_no: "00000002",
		series: "2C26MAA",
		lookup_code: "ZEDALU99BE",
		lookup_url: "https://einvoice.mock.invalid/tra-cuu/ZEDALU99BE",
		amount: 29000,
	},
};

function backendWith(work: Record<string, unknown>, claim = true) {
	return fakeBackend({
		einvoice_job_claim: () => claim,
		einvoice_job_work: () => ({ invoices: [], emails: [], ...work }),
		einvoice_job_result: () => ({ state: "issued" }),
	});
}

async function run(
	backend: ReturnType<typeof fakeBackend>,
	options: {
		environment?: Record<string, string>;
		ledger?: MockLedger;
		ticket?: unknown;
		log?: string[];
		mailer?: ReturnType<typeof createMockMailer> | null;
		script?: { operation: "issue"; failure: "timeout"; afterWork: boolean }[];
	} = {},
): Promise<Response> {
	return await handleEInvoiceJob(
		new Request(URL_, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ticket: options.ticket ?? TICKET }),
		}),
		options.environment ?? ENVIRONMENT,
		{
			backend,
			...(options.ledger === undefined ? {} : { mockLedger: options.ledger }),
			...(options.script === undefined ? {} : { mockScript: options.script }),
			...(options.mailer === undefined ? {} : { mailer: options.mailer }),
			clock: () => Date.parse("2026-11-25T03:00:00Z"),
			log: (line) => options.log?.push(line),
		},
	);
}

function results(backend: ReturnType<typeof fakeBackend>) {
	return backend
		.callsTo("einvoice_job_result")
		.map((call) => call.args.p_request as Record<string, unknown>);
}

Deno.test("a malformed ticket is 400 and a refused ticket 401, with no work done", async () => {
	const backend = backendWith({ invoices: [sale()] }, false);
	assertEquals((await run(backend, { ticket: "x" })).status, 400, "malformed");
	assertEquals((await run(backend)).status, 401, "refused");
	assertEquals(
		backend.callsTo("einvoice_job_work").length,
		0,
		"no work list was read",
	);
});

Deno.test("a sale invoice is issued by the mock and reported under its claim", async () => {
	const backend = backendWith({ invoices: [sale()] });
	const response = await run(backend);
	assertEquals(response.status, 200, "ok");
	assertEquals((await response.json()).issued, 1, "one issued");
	const [result] = results(backend);
	assertEquals(
		[
			result?.invoice_id,
			result?.claim,
			result?.outcome,
			result?.action,
			result?.amount,
			result?.invoice_no,
			result?.series,
		],
		[INVOICE_ID, CLAIM, "issued", "issue", 29000, "00000001", "2C26MAA"],
		"the result names the document, its claim and the provider's numbers",
	);
	assert(
		typeof result?.lookup_url === "string" &&
			result.lookup_url.startsWith("https://"),
		"with an https lookup address",
	);
});

Deno.test("a lost answer is recovered by the next run asking first: one invoice at the provider", async () => {
	const ledger = new MockLedger();
	const first = backendWith({ invoices: [sale()] });
	await run(first, {
		ledger,
		script: [{ operation: "issue", failure: "timeout", afterWork: true }],
	});
	assertEquals(
		results(first)[0],
		{
			kind: "invoice",
			invoice_id: INVOICE_ID,
			claim: CLAIM,
			outcome: "failed",
			error_class: "timeout",
		},
		"the first run reports a timeout",
	);
	const second = backendWith({ invoices: [sale({ query_first: true })] });
	await run(second, { ledger });
	assertEquals(
		[results(second)[0]?.outcome, results(second)[0]?.invoice_no],
		["issued", "00000001"],
		"the second run records the invoice made",
	);
	assertEquals(ledger.documents.size, 1, "and never makes a second one");
	assertEquals(ledger.calls, ["issue", "query"], "it asked instead of issuing");
});

Deno.test("a cancellation the provider refuses is reported as an adjustment to zero", async () => {
	const ledger = new MockLedger();
	await run(backendWith({ invoices: [sale()] }), { ledger });
	const issued = ledger.documents.get(INVOICE_ID);
	const backend = backendWith({
		invoices: [
			sale({
				invoice_id: ADJUST_ID,
				kind: "cancellation",
				action: "cancel",
				reason: "refund",
				amount: -29000,
				lines: [],
				original: {
					invoice_id: INVOICE_ID,
					provider_ref: issued?.providerRef,
					invoice_no: issued?.invoiceNo,
					series: issued?.series,
					issued_at: issued?.issuedAt,
					amount: 29000,
				},
			}),
		],
	});
	await run(backend, { ledger });
	assertEquals(
		[
			results(backend)[0]?.outcome,
			results(backend)[0]?.action,
			results(backend)[0]?.amount,
		],
		["issued", "adjust", -29000],
		"adjusted to zero",
	);
});

Deno.test("the mock where EINVOICE_MOCK is not on, and a missing key, are not_configured; the key never reaches the log", async () => {
	const log: string[] = [];
	const offline = backendWith({ invoices: [sale()] });
	await run(offline, { environment: { EINVOICE_KEY_BRAND_1: KEY }, log });
	assertEquals(
		results(offline)[0]?.error_class,
		"not_configured",
		"the mock is refused",
	);
	const missing = backendWith({ invoices: [sale()] });
	await run(missing, { environment: { EINVOICE_MOCK: "on" }, log });
	assertEquals(results(missing)[0]?.error_class, "not_configured", "no key");
	assert(!log.join("\n").includes(KEY), "the key is never logged");
});

Deno.test("a malformed document is reported for a person, a document without a claim is left to lapse", async () => {
	const backend = backendWith({
		invoices: [sale({ lines: "x" }), { invoice_id: "x" }],
	});
	const body = await (await run(backend)).json();
	assertEquals(body.errors, 2, "both counted");
	assertEquals(
		results(backend),
		[
			{
				kind: "invoice",
				invoice_id: INVOICE_ID,
				claim: CLAIM,
				outcome: "failed",
				error_class: "rejected_data",
			},
		],
		"only the one with its claim is reported",
	);
});

Deno.test("the company invoice email goes through the mock mailer; without a mailer it is no_mailer; the log holds no buyer data", async () => {
	const log: string[] = [];
	const mailer = createMockMailer();
	const buyer = {
		tax_code: BUYER_TAX,
		company_name: BUYER_NAME,
		address: "12 Đường Số 3",
		email: BUYER_EMAIL,
	};
	const sent = backendWith({
		emails: [email],
		invoices: [sale({ buyer, kind: "sale" })],
	});
	await run(sent, { mailer, log });
	assertEquals(
		results(sent).at(-1),
		{ kind: "email", request_id: REQUEST_ID, ok: true },
		"the email is reported sent",
	);
	assertEquals(mailer.sent.length, 1, "through the mailer");
	assertEquals(mailer.sent[0]?.to, BUYER_EMAIL, "to the request's address");
	const none = backendWith({ emails: [email] });
	await run(none, { mailer: null, log });
	assertEquals(
		results(none)[0],
		{
			kind: "email",
			request_id: REQUEST_ID,
			ok: false,
			error_class: "no_mailer",
		},
		"no mailer",
	);
	const mockEnvironment = backendWith({ emails: [email] });
	await run(mockEnvironment, {
		environment: { ...ENVIRONMENT, EINVOICE_MAILER: "mock" },
		log,
	});
	assertEquals(
		results(mockEnvironment)[0]?.ok,
		true,
		"EINVOICE_MAILER=mock picks the mock mailer",
	);
	const text = log.join("\n");
	assert(
		!text.includes(BUYER_TAX) &&
			!text.includes(BUYER_NAME) &&
			!text.includes(BUYER_EMAIL),
		"no tax code, name or address in the log (C18-S4)",
	);
});

Deno.test("only POST is served", async () => {
	const response = await handleEInvoiceJob(
		new Request(URL_, { method: "GET" }),
		ENVIRONMENT,
		{ backend: backendWith({}) },
	);
	assertEquals(response.status, 405, "GET is refused");
});
