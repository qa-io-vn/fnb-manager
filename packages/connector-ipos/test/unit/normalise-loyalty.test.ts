import type { CanonicalStore } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { buildMasterIndex } from "../../src/connector/master-index.js";
import { resolveIposOptions } from "../../src/connector/options.js";
import { buildSales } from "../../src/connector/sales.js";
import {
	invoiceLineSchema,
	invoiceSchema,
	paymentSchema,
} from "../../src/schemas/accounting.js";
import {
	fakeUuid,
	makeInvoice,
	makePayment,
	STORE_UID,
} from "../fixtures/factories.js";

const TRAN_DATE = Date.parse("2026-11-19T03:00:00.000Z");
const STORE: CanonicalStore = {
	externalId: STORE_UID,
	name: "Synthetic store",
	timezone: "Asia/Ho_Chi_Minh",
	dayStartMinutes: 0,
	currency: "VND",
};
const INDEX = buildMasterIndex({
	items: [],
	itemTypes: [],
	itemClasses: [],
	units: [],
	customizations: [],
	sources: [],
	paymentMethods: [],
	promotions: [],
	packages: [],
});
const OPTIONS = resolveIposOptions({});

function line(
	tranId: string,
	id: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		tran_id: tranId,
		tran_date: TRAN_DATE,
		id,
		item_id: "ITEM-A",
		item_name: "Synthetic drink",
		quantity: 1,
		price: 50_000,
		amount: 50_000,
		...overrides,
	};
}

function build(
	invoice: Record<string, unknown>,
	lines: Record<string, unknown>[],
	payments: Record<string, unknown>[],
) {
	const built = buildSales(
		{
			invoices: [invoiceSchema.parse(invoice)],
			lines: lines.map((row) => invoiceLineSchema.parse(row)),
			payments: payments.map((row) => paymentSchema.parse(row)),
		},
		STORE,
		INDEX,
		OPTIONS,
	);
	const sale = built.sales[0];
	if (!sale) {
		throw new Error("no sale");
	}
	return sale;
}

describe("loyalty fields from synthetic sale payloads", () => {
	it("a member-attached invoice carries the phone and name, from the header or else the payment rows", () => {
		const header = makeInvoice(1, TRAN_DATE);
		const attached = build(
			{
				...header,
				customer_phone: "0900000101",
				customer_name: "Synthetic member",
			},
			[line(header.tran_id, "L1")],
			[makePayment(1, TRAN_DATE, { tran_id: header.tran_id, amount: 100_000 })],
		);
		expect([attached.customerPhone, attached.customerName]).toEqual([
			"0900000101",
			"Synthetic member",
		]);

		const fromPayment = build(
			{ ...header, customer_phone: "", customer_name: "" },
			[line(header.tran_id, "L1")],
			[
				makePayment(1, TRAN_DATE, {
					tran_id: header.tran_id,
					amount: 60_000,
					customer_phone: "",
				}),
				makePayment(2, TRAN_DATE, {
					tran_id: header.tran_id,
					amount: 40_000,
					customer_phone: " 0900000102 ",
					customer_name: "Synthetic payer",
				}),
			],
		);
		expect([fromPayment.customerPhone, fromPayment.customerName]).toEqual([
			"0900000102",
			"Synthetic payer",
		]);

		const anonymous = build(
			header,
			[line(header.tran_id, "L1")],
			[makePayment(1, TRAN_DATE, { tran_id: header.tran_id })],
		);
		expect([anonymous.customerPhone, anonymous.customerName]).toEqual([
			undefined,
			undefined,
		]);
	});

	it("a voucher invoice keeps the code, its name and the promotion line, with the discount on the lines", () => {
		const header = makeInvoice(2, TRAN_DATE);
		const sale = build(
			{
				...header,
				voucher_code: " SYN123 ",
				voucher_name: "Synthetic programme",
				voucher_amount_paid: 0,
				amount_origin: 80_000,
				amount_discount_price: 20_000,
				total_amount: 80_000,
			},
			[
				line(header.tran_id, "L1", {
					price: 0,
					amount: 0,
					amount_discount_on_price: 20_000,
					promotion_id: "100001",
					promotion_name: "Synthetic programme",
				}),
				line(header.tran_id, "L2", {
					item_id: "ITEM-B",
					amount: 80_000,
					price: 80_000,
				}),
			],
			[makePayment(2, TRAN_DATE, { tran_id: header.tran_id, amount: 80_000 })],
		);
		expect([sale.voucherCode, sale.voucherName, sale.voucherAmount]).toEqual([
			"SYN123",
			"Synthetic programme",
			0,
		]);
		expect(sale.itemDiscountAmount).toBe(20_000);
		expect(
			sale.lines.map((row) => [row.promotionExternalId, row.promotionName]),
		).toEqual([
			["100001", "Synthetic programme"],
			[undefined, undefined],
		]);
	});

	it("a discount-entry invoice keeps the entry name and amount as the bill discount", () => {
		const header = makeInvoice(3, TRAN_DATE);
		const sale = build(
			{
				...header,
				discount_extra_name: "Synthetic free drink",
				discount_extra_amount: 30_000,
				amount_origin: 100_000,
				total_amount: 70_000,
			},
			[line(header.tran_id, "L1", { amount: 100_000, price: 100_000 })],
			[makePayment(3, TRAN_DATE, { tran_id: header.tran_id, amount: 70_000 })],
		);
		expect([
			sale.billDiscountName,
			sale.billDiscountAmount,
			sale.voucherCode,
		]).toEqual(["Synthetic free drink", 30_000, undefined]);
		expect(sale.netAmount).toBe(70_000);
	});

	it("keeps vendor field names out of the canonical sale", () => {
		const header = makeInvoice(4, TRAN_DATE);
		const sale = build(
			{ ...header, voucher_code: "SYN123" },
			[line(header.tran_id, "L1")],
			[],
		);
		const { raw: _raw, lines, payments, ...canonical } = sale;
		expect(Object.keys(canonical).join(" ")).not.toMatch(/_/);
		expect(
			lines.flatMap(({ raw: _line, ...rest }) => Object.keys(rest)).join(" "),
		).not.toMatch(/_/);
		expect(payments.length).toBe(1);
		expect(fakeUuid(1)).toMatch(/^[0-9a-f-]{36}$/);
	});
});
