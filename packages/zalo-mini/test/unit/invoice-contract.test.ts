import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	COMPANY_ADDRESS_MAX,
	COMPANY_NAME_MAX,
	checkCompany,
	companyTextProblem,
	companyWire,
	emailProblem,
	INVOICE_FUNCTIONS,
	invoiceStatusArgs,
	normalizeTaxCode,
	readDeleteSavedCompanyAnswer,
	readEInvoicePill,
	readInvoiceStatus,
	readRequestInvoiceAnswer,
	readSavedCompanies,
	requestInvoiceArgs,
	savedCompanyArgs,
	taxCodeProblem,
} from "../../src/ordering/invoice-contract";
import { createRestOrderingClient } from "../../src/ordering/rest-ordering-client";

// Test design (ISTQB) for the company invoice contract (C18, Q01; docs/api.md 3.30; ADR-070):
// - the client's checks mirror app.einvoice_company_input (the server stays the authority):
//   tax code, equivalence partitions and boundaries: 9, 10, 11, 12, 13, 14 digits; 10-3 with a branch; a hyphen in the
//   wrong place; letters; a space inside; spaces around (trimmed); empty; only spaces; a full-width digit; a tab;
//   email partitions (valid, no @, no domain, no final label, trailing, leading and double dot, a label with a hyphen
//   at its end, a one-letter final label, a space inside, 254 and 255 characters, a local part of 64 and 65);
//   name and address boundaries (1, 200, 201 and 300, 301 characters), Vietnamese letters accepted, control
//   characters, newlines, CR LF and markup braces refused (never escaped);
// - the readers (equivalence partitions per answer): the status of an eligible order (day 7 of the window as the server
//   answers it) and of one past its window (day 8), another customer's order (unknown_order and nothing else), a
//   request received, replayed and refused with its fields, the pill's seven states, saved companies; malformed
//   answers refused (an unknown state, eligible with a refusal, a day that is not a date, a field unknown);
// - the client calls the functions and parameter names the SQL declares, and refuses ids that are not UUIDs before
//   any call.

const ORDER = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const INVOICE = "33333333-3333-4333-8333-333333333333";
const COMPANY = "44444444-4444-4444-8444-444444444444";

const REQUEST_JSON = {
	id: REQUEST,
	order_id: ORDER,
	source: "app",
	status: "received",
	tax_code: "0312345678",
	company_name: "Công ty TNHH Mẫu",
	address: "12 Đường Mẫu, Quận 1",
	email: "ketoan@example.com",
	requested_at: "2026-11-27T07:21:00Z",
	issued_at: null,
	emailed_at: null,
	invoice: null,
};

const PILL = {
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
};

function status(overrides: Record<string, unknown> = {}) {
	return {
		order_id: ORDER,
		display_no: "#027",
		paid_at: "2026-11-20T07:00:00Z",
		total: 167000,
		eligible: true,
		refusal: null,
		window_days: 7,
		last_day: "2026-11-27",
		request: null,
		einvoice: PILL,
		...overrides,
	};
}

describe("the tax code (EP and BVA)", () => {
	it.each([
		["0312345678", "0312345678"],
		["0312345678-001", "0312345678-001"],
		["0312345678001", "0312345678-001"],
		["  0312345678  ", "0312345678"],
		[" 0312345678-001", "0312345678-001"],
	])("accepts %j as %j", (typed, printed) => {
		expect(normalizeTaxCode(typed)).toBe(printed);
		expect(taxCodeProblem(typed)).toBeNull();
	});

	it.each([
		["031234567", 9],
		["03123456789", 11],
		["031234567890", 12],
		["03123456780011", 14],
		["03123456", 8],
	])("refuses %j: only digits, %i of them", (typed, digits) => {
		expect(normalizeTaxCode(typed)).toBeNull();
		expect(taxCodeProblem(typed)).toEqual({
			field: "tax_code",
			kind: "digits",
			count: digits,
		});
	});

	it.each([
		["031234567-8001", "format"],
		["0312345678-01", "format"],
		["0312345678-0011", "format"],
		["03123A5678", "characters"],
		["MST0312345678", "characters"],
		["0312 345678", "characters"],
		["0312345678\t", "characters"],
		["０３１２３４５６７８", "characters"],
		["0312345678 001", "characters"],
	])("refuses %j (%s)", (typed, kind) => {
		expect(normalizeTaxCode(typed)).toBeNull();
		expect(taxCodeProblem(typed)?.kind).toBe(kind);
	});

	it("calls empty and spaces-only codes empty", () => {
		expect(taxCodeProblem("")?.kind).toBe("empty");
		expect(taxCodeProblem("    ")?.kind).toBe("empty");
	});
});

describe("the company name and address (BVA, EP)", () => {
	it("take 1 and 200 characters of a name and 300 of an address, refuse 201 and 301", () => {
		expect(companyTextProblem("company_name", "A")).toBeNull();
		expect(companyTextProblem("company_name", "a".repeat(200))).toBeNull();
		expect(companyTextProblem("company_name", "a".repeat(201))).toEqual({
			field: "company_name",
			kind: "too_long",
			max: COMPANY_NAME_MAX,
		});
		expect(companyTextProblem("address", "b".repeat(300))).toBeNull();
		expect(companyTextProblem("address", "b".repeat(301))).toEqual({
			field: "address",
			kind: "too_long",
			max: COMPANY_ADDRESS_MAX,
		});
	});

	it("count characters, not bytes: 200 Vietnamese letters with marks are fine", () => {
		expect(companyTextProblem("company_name", "Ệ".repeat(200))).toBeNull();
		expect(companyTextProblem("company_name", "Ệ".repeat(201))?.kind).toBe(
			"too_long",
		);
		expect(
			companyTextProblem(
				"company_name",
				"Công ty TNHH Thương mại Dịch vụ Ẩm thực Đông Á",
			),
		).toBeNull();
	});

	it("trim the spaces around and refuse an empty value", () => {
		expect(companyTextProblem("address", "   12 Đường Mẫu   ")).toBeNull();
		expect(companyTextProblem("address", "")?.kind).toBe("empty");
		expect(companyTextProblem("company_name", "     ")?.kind).toBe("empty");
	});

	it.each([
		["Công ty\nMẫu", "line"],
		["Công ty\r\nMẫu", "line"],
		["Công ty\tMẫu", "line"],
		["Công ty\u0000Mẫu", "line"],
		["Công ty\u2028Mẫu", "line"],
		["<script>alert(1)</script>", "markup"],
		["{{ constructor }}", "markup"],
		["Công ty > Mẫu", "markup"],
	])("refuse %j (%s), never escape it", (value, kind) => {
		expect(companyTextProblem("company_name", value)?.kind).toBe(kind);
		expect(companyTextProblem("address", value)?.kind).toBe(kind);
	});
});

describe("the email (EP and BVA)", () => {
	// a domain other than example.com or example.org is built at run time, so no address of a real domain is in the source
	it.each([
		"ketoan@example.com",
		"ke.toan+hd@example.org",
		`ke.toan@sub.${"example.org"}`,
		`a_b%c-d@ex-${"ample.com"}`,
		"  ketoan@example.com  ",
	])("accepts %j", (email) => {
		expect(emailProblem(email)).toBeNull();
	});

	it.each([
		["", "empty"],
		["ketoan", "format"],
		["ketoan@", "format"],
		["ketoan@example", "format"],
		["ketoan@example.c", "format"],
		["ketoan@example.com.", "format"],
		[".ketoan@example.com", "format"],
		["ketoan.@example.com", "format"],
		["ke..toan@example.com", "format"],
		[`ketoan@example-${".com"}`, "format"],
		["ke toan@example.com", "format"],
		["ketoan@example.com\r\nBcc: x@example.com", "format"],
		["ketoan@@example.com", "format"],
	])("refuses %j (%s)", (email, kind) => {
		expect(emailProblem(email)?.kind).toBe(kind);
	});

	it("takes 254 characters and a local part of 64, refuses 255 and 65", () => {
		const domain = `${"d".repeat(60)}.${"e".repeat(60)}.${"f".repeat(60)}.${"g".repeat(60)}.com`;
		const at254 = `${"a".repeat(254 - domain.length - 1)}@${domain}`;
		expect(at254).toHaveLength(254);
		expect(emailProblem(at254)).toBeNull();
		expect(emailProblem(`a${at254}`)?.kind).toBe("too_long");
		expect(emailProblem(`${"a".repeat(64)}@example.com`)).toBeNull();
		expect(emailProblem(`${"a".repeat(65)}@example.com`)?.kind).toBe(
			"too_long",
		);
	});
});

describe("a whole company", () => {
	it("is clean when every field passes, with the tax code as invoices print it", () => {
		const check = checkCompany({
			taxCode: " 0312345678001 ",
			companyName: " Công ty TNHH Mẫu ",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com ",
		});
		expect(check.problems).toEqual([]);
		expect(check.company).toEqual({
			taxCode: "0312345678-001",
			companyName: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
		expect(companyWire(check.company ?? (null as never))).toEqual({
			tax_code: "0312345678-001",
			company_name: "Công ty TNHH Mẫu",
			address: "12 Đường Mẫu",
			email: "ketoan@example.com",
		});
	});

	it("names every field in error, in the fields' order, and holds no company", () => {
		const check = checkCompany({
			taxCode: "03123456",
			companyName: "",
			address: "<b>",
			email: "ketoan@example",
		});
		expect(check.company).toBeNull();
		expect(check.problems.map((problem) => problem.field)).toEqual([
			"tax_code",
			"company_name",
			"address",
			"email",
		]);
	});
});

describe("the invoice status (C18, C14)", () => {
	it("reads an order inside its window: day 7 of 7 as the server answers it, eligible", () => {
		const read = readInvoiceStatus(status());
		expect(read).toMatchObject({
			state: "known",
			eligible: true,
			refusal: null,
			windowDays: 7,
			lastDay: "2026-11-27",
			total: 167000,
		});
		if (read.state !== "known") throw new Error("known");
		expect(read.einvoice?.state).toBe("pending");
	});

	it("reads day 8: window_passed, with the last day", () => {
		const read = readInvoiceStatus(
			status({ eligible: false, refusal: "window_passed" }),
		);
		expect(read).toMatchObject({
			eligible: false,
			refusal: "window_passed",
			lastDay: "2026-11-27",
		});
	});

	it.each([
		"already_requested",
		"einvoice_off",
		"not_paid",
		"refunded",
		"nothing_to_invoice",
	])("reads the refusal %s", (refusal) => {
		expect(
			readInvoiceStatus(
				status({
					eligible: false,
					refusal,
					request: refusal === "already_requested" ? REQUEST_JSON : null,
				}),
			),
		).toMatchObject({ eligible: false, refusal });
	});

	it("reads another customer's order as unknown and nothing else", () => {
		expect(
			readInvoiceStatus({
				order_id: ORDER,
				eligible: false,
				refusal: "unknown_order",
				request: null,
				einvoice: null,
			}),
		).toEqual({ state: "unknown_order", orderId: ORDER });
	});

	it("refuses a malformed status", () => {
		expect(() =>
			readInvoiceStatus(status({ eligible: true, refusal: "not_paid" })),
		).toThrow();
		expect(() =>
			readInvoiceStatus(status({ refusal: "cosmic_rays" })),
		).toThrow();
		expect(() =>
			readInvoiceStatus(status({ last_day: "27/11/2026" })),
		).toThrow();
		expect(() => readInvoiceStatus(status({ order_id: "1 or 1=1" }))).toThrow();
		expect(() => readInvoiceStatus([])).toThrow();
	});
});

describe("the e-invoice pill", () => {
	it.each([
		"pending",
		"issued",
		"retrying",
		"failed",
		"cancelled",
		"off",
		"none",
	])("reads the state %s", (state) => {
		expect(readEInvoicePill({ ...PILL, state, invoice: null }).state).toBe(
			state,
		);
	});

	it("keeps an https lookup address and drops any other", () => {
		const issued = {
			...PILL,
			state: "issued",
			invoice: {
				...PILL.invoice,
				state: "issued",
				mode: "sandbox",
				invoice_no: "000127",
				series: "C26MAA",
				lookup_code: "ABC123",
				lookup_url: "https://lookup.example.com/ABC123",
				amount: 167000,
				issued_at: "2026-11-27T07:07:00Z",
			},
		};
		expect(readEInvoicePill(issued).invoice).toMatchObject({
			invoiceNo: "000127",
			lookupUrl: "https://lookup.example.com/ABC123",
			amount: 167000,
		});
		expect(
			readEInvoicePill({
				...issued,
				invoice: { ...issued.invoice, lookup_url: "javascript:alert(1)" },
			}).invoice?.lookupUrl,
		).toBeNull();
	});

	it("refuses an unknown state or kind", () => {
		expect(() => readEInvoicePill({ ...PILL, state: "lost" })).toThrow();
		expect(() =>
			readEInvoicePill({ ...PILL, invoice: { ...PILL.invoice, kind: "gift" } }),
		).toThrow();
	});
});

describe("the request answer (C18)", () => {
	it("reads a received request, a replay and whether the company was kept", () => {
		expect(
			readRequestInvoiceAnswer({
				state: "received",
				refusal: null,
				replayed: false,
				request: REQUEST_JSON,
				saved: true,
			}),
		).toMatchObject({ state: "received", replayed: false, saved: true });
		expect(
			readRequestInvoiceAnswer({
				state: "received",
				refusal: null,
				replayed: true,
				request: REQUEST_JSON,
				saved: null,
			}),
		).toMatchObject({ replayed: true, saved: null });
	});

	it("reads the refusals with their fields, last day, retry time and request", () => {
		expect(
			readRequestInvoiceAnswer({
				state: "refused",
				refusal: "invalid",
				fields: ["tax_code", "email"],
				request: null,
			}),
		).toMatchObject({ refusal: "invalid", fields: ["tax_code", "email"] });
		expect(
			readRequestInvoiceAnswer({
				state: "refused",
				refusal: "window_passed",
				last_day: "2026-11-27",
				request: null,
			}),
		).toMatchObject({ lastDay: "2026-11-27" });
		expect(
			readRequestInvoiceAnswer({
				state: "refused",
				refusal: "rate_limited",
				retry_at: "2026-11-27T08:00:00Z",
				request: null,
			}),
		).toMatchObject({ retryAt: "2026-11-27T08:00:00Z" });
		expect(
			readRequestInvoiceAnswer({
				state: "refused",
				refusal: "already_requested",
				request: REQUEST_JSON,
			}),
		).toMatchObject({ request: { id: REQUEST } });
	});

	it("refuses an unknown field or state", () => {
		expect(() =>
			readRequestInvoiceAnswer({
				state: "refused",
				refusal: "invalid",
				fields: ["password"],
			}),
		).toThrow();
		expect(() => readRequestInvoiceAnswer({ state: "maybe" })).toThrow();
		expect(() =>
			readRequestInvoiceAnswer({
				state: "received",
				request: { ...REQUEST_JSON, status: "lost" },
			}),
		).toThrow();
	});
});

describe("saved companies", () => {
	it("reads the list and a deletion", () => {
		expect(
			readSavedCompanies({
				companies: [
					{
						id: COMPANY,
						tax_code: "0312345678",
						company_name: "Công ty TNHH Mẫu",
						address: "12 Đường Mẫu",
						email: "ketoan@example.com",
						updated_at: "2026-11-27T07:21:00Z",
					},
				],
			}).companies[0],
		).toMatchObject({ id: COMPANY, taxCode: "0312345678" });
		expect(readDeleteSavedCompanyAnswer({ state: "deleted" })).toEqual({
			state: "deleted",
		});
		expect(
			readDeleteSavedCompanyAnswer({
				state: "refused",
				refusal: "unknown_company",
			}),
		).toEqual({ state: "refused", refusal: "unknown_company" });
		expect(() => readSavedCompanies({ companies: "none" })).toThrow();
	});
});

describe("the REST client's invoice calls", () => {
	function recording(answer: unknown) {
		const calls: { fn: string; args: unknown }[] = [];
		const rest: RestClient = {
			select: async () => [],
			rpc: async (fn, args) => {
				calls.push({ fn, args });
				return answer;
			},
		};
		return { calls, client: createRestOrderingClient(rest) };
	}

	it("call the functions and parameter names the SQL declares", async () => {
		const read = recording(status());
		await read.client.invoiceStatus(ORDER);
		expect(read.calls).toEqual([
			{ fn: INVOICE_FUNCTIONS.status, args: { p_order: ORDER } },
		]);
		const ask = recording({
			state: "received",
			refusal: null,
			replayed: false,
			request: REQUEST_JSON,
			saved: false,
		});
		await ask.client.requestInvoice({
			requestId: REQUEST,
			orderId: ORDER,
			save: false,
			company: {
				taxCode: "0312345678",
				companyName: "Công ty TNHH Mẫu",
				address: "12 Đường Mẫu",
				email: "ketoan@example.com",
			},
		});
		expect(ask.calls[0]).toEqual({
			fn: "customer_request_invoice",
			args: {
				p_request: {
					request_id: REQUEST,
					order: ORDER,
					company: {
						tax_code: "0312345678",
						company_name: "Công ty TNHH Mẫu",
						address: "12 Đường Mẫu",
						email: "ketoan@example.com",
					},
					save: false,
				},
			},
		});
		const saved = recording({
			state: "received",
			refusal: null,
			replayed: false,
			request: REQUEST_JSON,
			saved: false,
		});
		await saved.client.requestInvoice({
			requestId: REQUEST,
			orderId: ORDER,
			save: false,
			savedCompany: COMPANY,
		});
		expect(saved.calls[0]?.args).toEqual({
			p_request: {
				request_id: REQUEST,
				order: ORDER,
				saved_company: COMPANY,
				save: false,
			},
		});
		const list = recording({ companies: [] });
		await list.client.savedCompanies();
		expect(list.calls[0]?.fn).toBe("customer_saved_companies");
		const gone = recording({ state: "deleted", refusal: null });
		await gone.client.deleteSavedCompany(COMPANY);
		expect(gone.calls[0]).toEqual({
			fn: "customer_delete_saved_company",
			args: { p_company: COMPANY },
		});
	});

	it("refuse ids that are not UUIDs before any call", async () => {
		const read = recording(null);
		await expect(read.client.invoiceStatus("../orders")).rejects.toThrow();
		await expect(read.client.deleteSavedCompany("1 or 1=1")).rejects.toThrow();
		expect(read.calls).toEqual([]);
		expect(() => invoiceStatusArgs("x")).toThrow();
		expect(() => savedCompanyArgs("x")).toThrow();
		expect(() =>
			requestInvoiceArgs({
				requestId: "not-a-uuid",
				orderId: ORDER,
				save: false,
				savedCompany: COMPANY,
			}),
		).toThrow();
	});
});
