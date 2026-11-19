import {
	canonicalSaleSchema,
	expectedNetFromComponents,
	expectedNetFromLines,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	NO_REWARD,
	parseSaleReward,
	simulatedSale,
} from "../../src/commands/loyalty-sale.js";
import { UsageError } from "../../src/context.js";

const BASE = {
	externalId: "sim-1",
	receiptNo: "0001",
	soldAt: new Date("2026-11-19T03:00:00.000Z"),
	businessDate: "2026-11-19",
	amount: 120_000,
	phone: null,
} as const;

function reward(
	discountName?: string,
	voucherCode?: string,
	discountAmount?: string,
) {
	return parseSaleReward(
		{ discountName, voucherCode, discountAmount },
		120_000,
	);
}

describe("parseSaleReward", () => {
	it("is no reward without options", () => {
		expect(reward()).toEqual(NO_REWARD);
	});

	it("reads a payment discount entry with its amount", () => {
		expect(reward("  Synthetic free drink ", undefined, "30.000")).toEqual({
			discountName: "Synthetic free drink",
			voucherCode: null,
			discountAmount: 30_000,
		});
	});

	it("reads a voucher code without an amount", () => {
		expect(reward(undefined, "SYN-P1")).toEqual({
			discountName: null,
			voucherCode: "SYN-P1",
			discountAmount: 0,
		});
	});

	it("refuses an amount without a discount name or voucher code", () => {
		expect(() => reward(undefined, undefined, "1000")).toThrow(UsageError);
	});

	it("refuses an amount above the sale or not whole", () => {
		expect(() => reward("Synthetic", undefined, "120001")).toThrow(UsageError);
		expect(() => reward("Synthetic", undefined, "-5")).toThrow(UsageError);
		expect(() => reward("Synthetic", undefined, "1.5e3")).toThrow(UsageError);
	});

	it("refuses a voucher code with a space and an empty discount name", () => {
		expect(() => reward(undefined, "SYN P1")).toThrow(UsageError);
		expect(() => reward("   ")).toThrow(UsageError);
	});
});

describe("simulatedSale", () => {
	it("keeps a plain sale unchanged", () => {
		const sale = simulatedSale(BASE);
		expect(sale.netAmount).toBe(120_000);
		expect(sale.billDiscountAmount).toBe(0);
		expect(sale.billDiscountName).toBeUndefined();
		expect(sale.voucherCode).toBeUndefined();
	});

	it("puts a payment discount entry on the bill and lowers the net", () => {
		const sale = simulatedSale({
			...BASE,
			reward: reward("Synthetic free drink", undefined, "30000"),
		});
		expect(sale.billDiscountName).toBe("Synthetic free drink");
		expect(sale.billDiscountAmount).toBe(30_000);
		expect(sale.voucherAmount).toBe(0);
		expect(sale.netAmount).toBe(90_000);
		expect(sale.paidAmount).toBe(90_000);
		expect(sale.payments[0]?.amount).toBe(90_000);
		expect(expectedNetFromComponents(sale)).toBe(sale.netAmount);
		expect(expectedNetFromLines(sale)).toBe(sale.netAmount);
		expect(canonicalSaleSchema.safeParse(sale).success).toBe(true);
	});

	it("puts a voucher code and its amount on the sale", () => {
		const sale = simulatedSale({
			...BASE,
			reward: reward(undefined, "SYN-P1", "25000"),
		});
		expect(sale.voucherCode).toBe("SYN-P1");
		expect(sale.voucherAmount).toBe(25_000);
		expect(sale.billDiscountAmount).toBe(0);
		expect(sale.netAmount).toBe(95_000);
		expect(expectedNetFromComponents(sale)).toBe(sale.netAmount);
	});

	it("gives the amount to the payment discount when both are named", () => {
		const sale = simulatedSale({
			...BASE,
			reward: reward("Synthetic ten percent", "SYN-P1", "12000"),
		});
		expect(sale.billDiscountAmount).toBe(12_000);
		expect(sale.voucherAmount).toBe(0);
		expect(sale.voucherCode).toBe("SYN-P1");
		expect(sale.netAmount).toBe(108_000);
	});
});
