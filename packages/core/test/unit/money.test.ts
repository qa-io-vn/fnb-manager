import { describe, expect, it } from "vitest";
import {
	type CanonicalLine,
	expectedNetFromComponents,
	expectedNetFromLines,
	itemQuantity,
	lineNetTotal,
	moneyEquals,
	paymentTotal,
	roundMoney,
	sumMoney,
} from "../../src/index.js";

function line(
	overrides: Partial<CanonicalLine> & Pick<CanonicalLine, "lineKind">,
): CanonicalLine {
	return {
		externalId: "L1",
		itemName: "Trà sữa (M)",
		baseName: "Trà sữa",
		quantity: 1,
		unitPrice: 45_000,
		grossAmount: 45_000,
		discountAmount: 0,
		netAmount: 45_000,
		raw: null,
		...overrides,
	};
}

describe("money helpers", () => {
	it("rounds to two decimals without binary drift", () => {
		expect(roundMoney(1.005)).toBe(1.01);
		expect(roundMoney(0.1 + 0.2)).toBe(0.3);
		expect(roundMoney(45_000)).toBe(45_000);
		expect(roundMoney(-2.345)).toBe(-2.35);
	});

	it("sums with rounding", () => {
		expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
		expect(sumMoney([])).toBe(0);
	});

	it("compares within a tolerance", () => {
		expect(moneyEquals(100, 100.004)).toBe(true);
		expect(moneyEquals(100, 100.01)).toBe(false);
		expect(moneyEquals(100_000, 100_900, 1_000)).toBe(true);
	});
});

describe("sale math", () => {
	const lines = [
		line({
			lineKind: "item",
			quantity: 2,
			grossAmount: 90_000,
			netAmount: 90_000,
		}),
		line({
			lineKind: "modifier",
			externalId: "L2",
			itemName: "50% Đá",
			baseName: "50% Đá",
			unitPrice: 0,
			grossAmount: 0,
			netAmount: 0,
		}),
		line({
			lineKind: "package_component",
			externalId: "L3",
			quantity: 1,
			grossAmount: 0,
			netAmount: 0,
		}),
	];

	it("excludes modifiers from item quantities", () => {
		expect(itemQuantity(lines)).toBe(3);
		expect(lineNetTotal(lines)).toBe(90_000);
	});

	it("derives the net amount from components and from lines", () => {
		const sale = {
			lines,
			grossAmount: 100_000,
			itemDiscountAmount: 10_000,
			billDiscountAmount: 5_000,
			voucherAmount: 20_000,
			serviceChargeAmount: 2_000,
			shippingFeeAmount: 15_000,
			vatAmount: 0,
			payments: [
				{
					methodExternalId: "PM1",
					methodName: "Tiền mặt",
					kind: "cash" as const,
					amount: 50_000,
					feeAmount: 0,
					raw: null,
				},
				{
					methodExternalId: "PM2",
					methodName: "Momo",
					kind: "ewallet" as const,
					amount: 32_000,
					feeAmount: 0,
					raw: null,
				},
			],
		};
		expect(expectedNetFromComponents(sale)).toBe(82_000);
		expect(expectedNetFromLines(sale)).toBe(82_000);
		expect(paymentTotal(sale)).toBe(82_000);
	});
});
