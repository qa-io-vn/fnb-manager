import { describe, expect, it } from "vitest";
import {
	createMockProvider,
	EInvoiceRefusedError,
	EInvoiceUnavailableError,
	type IssueRequest,
	MOCK_LOOKUP_BASE,
	MockLedger,
	type SellerSettings,
} from "../../src/index.js";

// einvoice:unit/mock — the mock provider the job, the counter and the e2e runs use until a provider is chosen: a
// document per id (a second issue under the same id is a duplicate), numbers per series, a lookup code derived from the
// key with a fixed vector, the tax authority's code of a cash register, replacement and adjustment of a valid original,
// no cancellation unless told, and the scripted failures, the lost answer above all.
// Techniques: state transitions of a mock document (valid -> replaced | cancelled), error guessing.

const seller: SellerSettings = {
	sellerTaxCode: "0312345678",
	template: "2",
	series: "C26MAA",
	vatRate: "none",
};
const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const ID3 = "33333333-3333-4333-8333-333333333333";
const KEY = "synthetic-einvoice-key";
const clock = () => new Date("2026-11-25T03:00:00.000Z");

const sale: IssueRequest = {
	invoiceId: ID,
	soldAt: "2026-11-25T03:00:00.000Z",
	amount: 29000,
	seller,
	buyer: null,
	lines: [{ name: "Cà phê sữa", quantity: 1, unitPrice: 29000, amount: 29000 }],
	paymentMethods: ["cash"],
	orderLabel: "#001",
	storeName: "Cửa hàng mẫu",
};
const buyer = {
	taxCode: "0312345678-001",
	companyName: "Công ty Bếp",
	address: "12 Đường Số 3",
	email: "hd@example.com",
};

describe("the mock provider", () => {
	it("issues a sale invoice with its number, the tax authority's code and a lookup code of a fixed vector", async () => {
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			clock,
		});
		const invoice = await provider.issue(sale);
		expect(invoice).toEqual({
			operation: "issue",
			providerRef: `mock-${ID}`,
			invoiceNo: "00000001",
			series: "2C26MAA",
			lookupCode: "ZEDALU99BE",
			lookupUrl: `${MOCK_LOOKUP_BASE}ZEDALU99BE`,
			taxAuthorityCode: "M2-26-MOCK0-00000000001",
			amount: 29000,
			issuedAt: "2026-11-25T03:00:00.000Z",
			emailed: false,
		});
		expect(invoice.taxAuthorityCode).toHaveLength(23);
	});

	it("refuses a second document under the same id, and answers it by query", async () => {
		const ledger = new MockLedger();
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			ledger,
			clock,
		});
		await provider.issue(sale);
		await expect(provider.issue(sale)).rejects.toMatchObject({
			errorClass: "rejected_duplicate",
		});
		expect((await provider.query(ID))?.invoiceNo).toBe("00000001");
		expect(await provider.query(ID2)).toBeNull();
		expect(ledger.documents.size).toBe(1);
	});

	it("loses the answer after making the document when scripted, so only a query finds it", async () => {
		const ledger = new MockLedger();
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			ledger,
			clock,
			script: [{ operation: "issue", failure: "timeout", afterWork: true }],
		});
		await expect(provider.issue(sale)).rejects.toBeInstanceOf(
			EInvoiceUnavailableError,
		);
		expect(ledger.documents.size).toBe(1);
		expect((await provider.query(ID))?.providerRef).toBe(`mock-${ID}`);
	});

	it("fails before the work when scripted so, making nothing", async () => {
		const ledger = new MockLedger();
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			ledger,
			script: [{ operation: "issue", failure: "unavailable" }],
		});
		await expect(provider.issue(sale)).rejects.toMatchObject({
			errorClass: "unavailable",
		});
		expect(ledger.documents.size).toBe(0);
		expect((await provider.issue(sale)).invoiceNo).toBe("00000001");
	});

	it("replaces a valid sale invoice with a company invoice, after which the sale invoice cannot be replaced again", async () => {
		const ledger = new MockLedger();
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			ledger,
			clock,
		});
		const issued = await provider.issue(sale);
		const original = {
			invoiceId: ID,
			providerRef: issued.providerRef,
			invoiceNo: issued.invoiceNo,
			series: issued.series,
			issuedAt: issued.issuedAt,
			amount: 29000,
		};
		const replaced = await provider.replace({
			...sale,
			invoiceId: ID2,
			buyer,
			original,
		});
		expect(replaced.operation).toBe("replace");
		expect(replaced.invoiceNo).toBe("00000002");
		expect(ledger.documents.get(ID)?.state).toBe("replaced");
		await expect(
			provider.replace({ ...sale, invoiceId: ID3, buyer, original }),
		).rejects.toMatchObject({ errorClass: "rejected_data" });
	});

	it("refuses a buyer the tax authority does not know (0000000000 in the mock)", async () => {
		const provider = createMockProvider({ secret: KEY, mode: "sandbox" });
		await expect(
			provider.issue({ ...sale, buyer: { ...buyer, taxCode: "0000000000" } }),
		).rejects.toBeInstanceOf(EInvoiceRefusedError);
	});

	it("adjusts by a refund and, by default, answers unsupported to a cancellation", async () => {
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			clock,
		});
		const issued = await provider.issue(sale);
		const original = {
			invoiceId: ID,
			providerRef: issued.providerRef,
			invoiceNo: issued.invoiceNo,
			series: issued.series,
			issuedAt: issued.issuedAt,
			amount: 29000,
		};
		const adjusted = await provider.adjust({
			invoiceId: ID2,
			original,
			amount: -10000,
			seller,
			reason: "refund",
			at: issued.issuedAt,
		});
		expect([adjusted.operation, adjusted.amount]).toEqual(["adjust", -10000]);
		expect(
			await provider.cancel({
				invoiceId: ID3,
				original: { ...original, amount: 19000 },
				seller,
				reason: "refund",
				at: issued.issuedAt,
			}),
		).toBe("unsupported");
	});

	it("cancels when told it may, after which the original takes nothing more", async () => {
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			clock,
			cancelSupported: true,
		});
		const issued = await provider.issue(sale);
		const original = {
			invoiceId: ID,
			providerRef: issued.providerRef,
			invoiceNo: issued.invoiceNo,
			series: issued.series,
			issuedAt: issued.issuedAt,
			amount: 29000,
		};
		const cancelled = await provider.cancel({
			invoiceId: ID2,
			original,
			seller,
			reason: "refund",
			at: issued.issuedAt,
		});
		expect(cancelled).toMatchObject({ operation: "cancel", amount: -29000 });
		await expect(
			provider.adjust({
				invoiceId: ID3,
				original,
				amount: -1,
				seller,
				reason: "x",
				at: issued.issuedAt,
			}),
		).rejects.toMatchObject({
			errorClass: "rejected_data",
		});
	});

	it("emails a company invoice itself only when told, and looks a document up by its reference", async () => {
		const provider = createMockProvider({
			secret: KEY,
			mode: "sandbox",
			sendsEmail: true,
		});
		const issued = await provider.issue({ ...sale, buyer });
		expect(issued.emailed).toBe(true);
		expect(await provider.lookup(issued.providerRef)).toEqual({
			lookupCode: issued.lookupCode,
			lookupUrl: issued.lookupUrl,
		});
		expect(await provider.lookup("mock-unknown")).toBeNull();
	});

	it("needs a key", () => {
		expect(() => createMockProvider({ secret: "", mode: "sandbox" })).toThrow();
	});
});
