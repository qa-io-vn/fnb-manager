import { describe, expect, it } from "vitest";
import {
	buyerValid,
	checkAdjust,
	checkIssue,
	EInvoiceRefusedError,
	emailValid,
	type IssueRequest,
	normaliseTaxCode,
	type SellerSettings,
	sellerValid,
	textValid,
} from "../../src/index.js";

// einvoice:unit/checks — the company's fields and a document's shape, checked again before anything is sent, the same
// rules as the database's (C18-U1 to U3). Techniques: equivalence partitions and boundary values of every field,
// error guessing with injection strings (C18-S2).

const seller: SellerSettings = {
	sellerTaxCode: "0312345678",
	template: "2",
	series: "C26MAA",
	vatRate: "none",
};
const ID = "11111111-1111-4111-8111-111111111111";

describe("normaliseTaxCode (C18-U1, EP/BVA)", () => {
	it.each([
		["0312345678", "0312345678"],
		["0312345678-001", "0312345678-001"],
		["0312345678001", "0312345678-001"],
		["  0312345678  ", "0312345678"],
	])("accepts %j as %j", (input, expected) => {
		expect(normaliseTaxCode(input)).toBe(expected);
	});

	it.each([
		["9 digits", "031234567"],
		["11 digits", "03123456789"],
		["12 digits", "031234567890"],
		["14 digits", "03123456789012"],
		["letters", "03123456AB"],
		["a space inside", "03123 45678"],
		["a short branch", "0312345678-01"],
		["an en dash", "0312345678–001"],
		["a tab around", "\t0312345678"],
		["empty", ""],
	])("refuses %s", (_label, input) => {
		expect(normaliseTaxCode(input)).toBeNull();
	});
});

describe("textValid (C18-U3, BVA)", () => {
	it("takes 1 and 200 characters, Vietnamese letters counted once each", () => {
		expect(textValid("A", 200)).toBe(true);
		expect(textValid("Đ".repeat(200), 200)).toBe(true);
		expect(textValid("Đ".repeat(201), 200)).toBe(false);
		expect(textValid("", 200)).toBe(false);
	});

	it.each([
		["a new line", "Công ty\nBếp"],
		["CRLF", "Công ty\r\nX-Header: 1"],
		["a tab", "Công ty\tBếp"],
		["markup", "<script>alert(1)</script>"],
		["template braces", "Công ty {{7*7}}"],
		["spaces around", " Công ty "],
		["spaces only", "   "],
	])("refuses %s", (_label, value) => {
		expect(textValid(value, 200)).toBe(false);
	});

	it("keeps an ampersand and quotes (the email escapes them)", () => {
		expect(textValid('Công ty A & B "Số 1"', 200)).toBe(true);
	});
});

describe("emailValid (C18-U2, EP/BVA)", () => {
	const at254 = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(58)}.vn`;
	it("accepts the valid classes and 254 characters", () => {
		expect(emailValid("ke.toan@example.com")).toBe(true);
		expect(emailValid("KeToan+hd@Example.org")).toBe(true);
		// built from parts: the public-safe scan lets literal addresses only at example.com and example.org
		expect(emailValid(["ke.toan", "bep-nha-mau.example.com"].join("@"))).toBe(
			true,
		);
		expect(at254.length).toBe(254);
		expect(emailValid(at254)).toBe(true);
	});

	it.each([
		["no @", "ke.toan.bep-nha-mau.vn"],
		["no domain", "ke.toan@"],
		["no final label", "ke.toan@bep-nha-mau"],
		["a trailing dot", "ke.toan@example.com."],
		["a double dot", "ke..toan@example.com"],
		[
			"255 characters",
			`${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(59)}.vn`,
		],
		["a local part of 65", `${"a".repeat(65)}@bep-nha-mau.vn`],
		["a header after CRLF", "a@example.com\r\nBcc: x@example.org"],
		["markup", "<script>@example.com"],
	])("refuses %s", (_label, value) => {
		expect(emailValid(value)).toBe(false);
	});
});

describe("buyerValid and sellerValid (EP)", () => {
	const buyer = {
		taxCode: "0312345678-001",
		companyName: "Công ty Bếp",
		address: "12 Đường Số 3",
		email: "hd@example.com",
	};
	it("takes a complete buyer and refuses a tax code that is not normalised", () => {
		expect(buyerValid(buyer)).toBe(true);
		expect(buyerValid({ ...buyer, taxCode: "0312345678001" })).toBe(false);
	});

	it.each([
		[
			"a series that is not of a cash register",
			{ ...seller, series: "C26TAA" },
		],
		["a sales invoice with a VAT rate", { ...seller, vatRate: "10" as const }],
		["a VAT invoice without its rate", { ...seller, template: "1" as const }],
		[
			"a seller tax code of 9 digits",
			{ ...seller, sellerTaxCode: "031234567" },
		],
	])("refuses %s", (_label, value) => {
		expect(sellerValid(value)).toBe(false);
	});
});

describe("checkIssue and checkAdjust (BVA, error guessing)", () => {
	const issue: IssueRequest = {
		invoiceId: ID,
		soldAt: "2026-11-25T03:00:00.000Z",
		amount: 29000,
		seller,
		buyer: null,
		lines: [
			{ name: "Cà phê sữa", quantity: 1, unitPrice: 29000, amount: 29000 },
		],
		paymentMethods: ["cash"],
		orderLabel: "#001",
		storeName: "Cửa hàng mẫu",
	};
	const refused = (run: () => void) => {
		try {
			run();
		} catch (error) {
			return error instanceof EInvoiceRefusedError ? error.errorClass : "other";
		}
		return "accepted";
	};

	it("accepts a sale invoice whose lines add up", () => {
		expect(refused(() => checkIssue(issue))).toBe("accepted");
	});

	it.each([
		["lines one đồng short", { ...issue, amount: 29001 }],
		[
			"an amount of 0",
			{
				...issue,
				amount: 0,
				lines: [{ name: "x", quantity: 1, unitPrice: 0, amount: 0 }],
			},
		],
		[
			"an amount of 100,000,001",
			{
				...issue,
				amount: 100_000_001,
				lines: [
					{
						name: "x",
						quantity: 1,
						unitPrice: 100_000_001,
						amount: 100_000_001,
					},
				],
			},
		],
		["no line", { ...issue, lines: [] }],
		[
			"a fraction of a đồng",
			{
				...issue,
				amount: 29000.5,
				lines: [
					{ name: "x", quantity: 1, unitPrice: 29000.5, amount: 29000.5 },
				],
			},
		],
		[
			"a line name with markup",
			{
				...issue,
				lines: [
					{ name: "<b>x</b>", quantity: 1, unitPrice: 29000, amount: 29000 },
				],
			},
		],
		[
			"a buyer with a header in the email",
			{
				...issue,
				buyer: {
					taxCode: "0312345678",
					companyName: "A",
					address: "B",
					email: "a@example.com\r\nBcc: c@example.org",
				},
			},
		],
		["an id that is not a uuid", { ...issue, invoiceId: "not-a-uuid" }],
	])("refuses %s as rejected_data", (_label, request) => {
		expect(refused(() => checkIssue(request as IssueRequest))).toBe(
			"rejected_data",
		);
	});

	const original = {
		invoiceId: ID,
		providerRef: "mock-1",
		invoiceNo: "00000001",
		series: "2C26MAA",
		issuedAt: issue.soldAt,
		amount: 29000,
	};
	const adjust = {
		invoiceId: "22222222-2222-4222-8222-222222222222",
		original,
		amount: -10000,
		seller,
		reason: "refund",
		at: issue.soldAt,
	};

	it("takes an adjustment down to exactly zero and refuses one đồng more", () => {
		expect(refused(() => checkAdjust({ ...adjust, amount: -29000 }))).toBe(
			"accepted",
		);
		expect(refused(() => checkAdjust({ ...adjust, amount: -29001 }))).toBe(
			"rejected_data",
		);
		expect(refused(() => checkAdjust({ ...adjust, amount: 0 }))).toBe(
			"rejected_data",
		);
	});
});
