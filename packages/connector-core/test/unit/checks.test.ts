import type {
	CanonicalAdjustment,
	CanonicalCatalog,
	CanonicalLine,
	CanonicalPayment,
	CanonicalSale,
	DataQualityFlag,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	adjustmentKey,
	checkAdjustments,
	checkBoundarySales,
	checkBusinessDates,
	checkControlTotals,
	checkFlags,
	checkLinelessSales,
	checkLineSums,
	checkModifierPresence,
	checkModifiers,
	checkNetComponents,
	checkPaginationCompleteness,
	checkPayments,
	checkStableIds,
	checkWindowEdges,
	describeViolations,
} from "../../src/conformance/index.js";

const context = {
	store: { timezone: "Asia/Ho_Chi_Minh", dayStartMinutes: 0 },
	window: { fromDate: "2026-11-07", toDate: "2026-11-07" },
	moneyTolerance: 1,
};

function line(overrides: Partial<CanonicalLine> = {}): CanonicalLine {
	return {
		externalId: "L1",
		lineKind: "item",
		itemName: "Trà sữa (M)",
		baseName: "Trà sữa",
		sizeLabel: "M",
		quantity: 1,
		unitPrice: 45_000,
		grossAmount: 45_000,
		discountAmount: 0,
		netAmount: 45_000,
		raw: null,
		...overrides,
	};
}

function sale(overrides: Partial<CanonicalSale> = {}): CanonicalSale {
	return {
		externalId: "T1",
		soldAt: new Date("2026-11-07T16:30:00.000Z"),
		businessDate: "2026-11-07",
		channel: "dine_in",
		guestCount: 0,
		grossAmount: 45_000,
		itemDiscountAmount: 0,
		billDiscountAmount: 0,
		voucherAmount: 0,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		netAmount: 45_000,
		paidAmount: 45_000,
		status: "completed",
		lines: [line()],
		payments: [
			{
				methodExternalId: "PM1",
				methodName: "Tiền mặt",
				kind: "cash",
				amount: 45_000,
				feeAmount: 0,
				raw: null,
			},
		],
		raw: null,
		...overrides,
	};
}

describe("conformance checks", () => {
	it("accepts a well-formed sale", () => {
		const sales = [sale()];
		expect(checkBusinessDates(sales, context)).toEqual([]);
		expect(checkLineSums(sales, context)).toEqual([]);
		expect(checkModifiers(sales)).toEqual([]);
		expect(checkPayments(sales, context)).toEqual([]);
	});

	it("names the business-date rule when a connector used the wrong timezone", () => {
		const utcDated = sale({ businessDate: "2026-11-08" });
		const violations = checkBusinessDates([utcDated], {
			...context,
			window: { fromDate: "2026-11-07", toDate: "2026-11-08" },
		});
		expect(violations).toHaveLength(1);
		expect(violations[0]?.rule).toBe("business-date");
		expect(violations[0]?.message).toContain("Asia/Ho_Chi_Minh");
		expect(describeViolations(violations)).toContain("business-date");
	});

	it("flags a sale outside the window", () => {
		const violations = checkBusinessDates(
			[
				sale({
					soldAt: new Date("2026-11-08T03:00:00.000Z"),
					businessDate: "2026-11-08",
				}),
			],
			context,
		);
		expect(violations.map((entry) => entry.rule)).toEqual(["business-date"]);
	});

	it("flags line sums and component identities that do not reach the net amount", () => {
		const broken = [sale({ netAmount: 40_000, paidAmount: 40_000 })];
		expect(checkLineSums(broken, context).map((entry) => entry.rule)).toEqual([
			"line-sums",
		]);
		expect(
			checkNetComponents(broken, context).map((entry) => entry.rule),
		).toEqual(["net-components"]);
		const voucherSale = sale({
			voucherAmount: 5_000,
			netAmount: 40_000,
			paidAmount: 40_000,
		});
		expect(checkLineSums([voucherSale], context)).toEqual([]);
		expect(checkNetComponents([voucherSale], context)).toEqual([]);
		expect(
			checkLineSums([sale({ lines: [] })], context).map((entry) => entry.rule),
		).toEqual(["line-sums"]);
		expect(checkLinelessSales([sale({ lines: [] })])).toEqual([]);
		expect(checkLinelessSales([sale()]).map((entry) => entry.rule)).toEqual([
			"no-lines",
		]);
	});

	it("checks modifier lines against the catalog", () => {
		const catalog: CanonicalCatalog = {
			items: [
				{
					externalId: "DR-1",
					name: "Trà sữa (M)",
					baseName: "Trà sữa",
					sizeLabel: "M",
					listPrice: 45_000,
					isModifier: false,
					active: true,
				},
				{
					externalId: "OPT-1",
					name: "50% Đá",
					baseName: "50% Đá",
					listPrice: 0,
					isModifier: true,
					active: true,
				},
			],
			itemTypes: [],
			itemClasses: [],
			modifiers: [],
			paymentMethods: [],
			sources: [],
			promotions: [],
			packages: [],
		};
		const modifier = line({
			externalId: "L2",
			lineKind: "modifier",
			itemExternalId: "OPT-1",
			itemName: "50% Đá",
			baseName: "50% Đá",
			sizeLabel: undefined,
			unitPrice: 0,
			grossAmount: 0,
			netAmount: 0,
			parentLineExternalId: "L1",
		});
		const drink = line({ itemExternalId: "DR-1" });
		expect(
			checkModifiers([sale({ lines: [drink, modifier] })], catalog),
		).toEqual([]);
		const asItem = { ...modifier, lineKind: "item" as const };
		expect(
			checkModifiers([sale({ lines: [drink, asItem] })], catalog).map(
				(entry) => entry.rule,
			),
		).toEqual(["modifier-catalog"]);
		const drinkAsModifier = {
			...drink,
			lineKind: "modifier" as const,
			unitPrice: 0,
			grossAmount: 0,
			netAmount: 0,
		};
		expect(
			checkModifiers([sale({ lines: [drinkAsModifier] })], catalog).map(
				(entry) => entry.rule,
			),
		).toEqual(["modifier-catalog"]);
		const unknownModifier = { ...modifier, itemExternalId: "GHOST" };
		expect(
			checkModifiers([sale({ lines: [drink, unknownModifier] })], catalog),
		).toEqual([]);
		expect(
			checkModifierPresence([sale({ lines: [drink] })], catalog).map(
				(entry) => entry.rule,
			),
		).toEqual(["modifier-presence"]);
		expect(
			checkModifierPresence([sale({ lines: [drink, modifier] })], catalog),
		).toEqual([]);
	});

	it("notices when a day boundary has no sales near it", () => {
		const start = sale({
			externalId: "T-START",
			soldAt: new Date("2026-11-06T17:00:30.000Z"),
		});
		const end = sale({
			externalId: "T-END",
			soldAt: new Date("2026-11-07T16:59:00.000Z"),
		});
		expect(
			checkBoundarySales([start, end], ["2026-11-07"], context, 60),
		).toEqual([]);
		expect(
			checkBoundarySales(
				[sale({ soldAt: new Date("2026-11-07T05:00:00.000Z") })],
				["2026-11-07"],
				context,
				60,
			).map((entry) => entry.rule),
		).toEqual(["boundary-sales", "boundary-sales"]);
	});

	it("validates emitted data-quality flags", () => {
		expect(checkFlags([{ code: "x", message: "y", severity: "warn" }])).toEqual(
			[],
		);
		expect(
			checkFlags([
				{ code: "", message: "y", severity: "warn" },
			] as unknown as DataQualityFlag[]).map((entry) => entry.rule),
		).toEqual(["flags"]);
	});

	it("flags modifiers that carry money or hang off another modifier", () => {
		const modifier = line({
			externalId: "L2",
			lineKind: "modifier",
			itemName: "50% Đá",
			baseName: "50% Đá",
			sizeLabel: undefined,
			unitPrice: 0,
			grossAmount: 0,
			netAmount: 0,
			parentLineExternalId: "L1",
		});
		expect(checkModifiers([sale({ lines: [line(), modifier] })])).toEqual([]);
		const paidModifier = { ...modifier, netAmount: 5_000 };
		expect(
			checkModifiers([sale({ lines: [line(), paidModifier] })]).map(
				(entry) => entry.rule,
			),
		).toEqual(["modifier-amounts"]);
		const orphan = { ...modifier, parentLineExternalId: "missing" };
		expect(
			checkModifiers([sale({ lines: [line(), orphan] })]).map(
				(entry) => entry.rule,
			),
		).toEqual(["modifier-parent"]);
	});

	it("flags payments that do not add up", () => {
		const violations = checkPayments([sale({ paidAmount: 50_000 })], context);
		expect(violations.map((entry) => entry.rule)).toEqual(["payments-sum"]);
	});

	it("compares control totals per business date ignoring voided sales", () => {
		const sales = [
			sale(),
			sale({ externalId: "T2" }),
			sale({ externalId: "T3", status: "voided" }),
		];
		const totals = [
			{
				businessDate: "2026-11-07",
				invoiceCount: 2,
				netAmount: 90_000,
				raw: null,
			},
		];
		expect(checkControlTotals(sales, totals, context)).toEqual([]);
		const wrong = [
			{
				businessDate: "2026-11-07",
				invoiceCount: 3,
				netAmount: 95_000,
				raw: null,
			},
		];
		expect(
			checkControlTotals(sales, wrong, context).map((entry) => entry.rule),
		).toEqual(["control-totals", "control-totals"]);
		expect(
			checkControlTotals(sales, [], context).map((entry) => entry.message),
		).toEqual([
			"2026-11-07: 2 sales emitted but no control total for that date",
		]);
	});

	it("detects unstable ids and incomplete pagination", () => {
		const first = [sale(), sale({ externalId: "T2" })];
		expect(checkStableIds(first, [...first].reverse())).toEqual([]);
		const half = { ...sale().payments[0], amount: 22_500 } as CanonicalPayment;
		const collapsed = sale({ payments: [half] });
		const split = sale({ payments: [half, { ...half }] });
		expect(
			checkStableIds([split], [collapsed]).map((entry) => entry.rule),
		).toEqual(["stable-ids"]);
		expect(
			checkStableIds(first, [sale(), sale({ externalId: "T2b" })]).map(
				(entry) => entry.rule,
			),
		).toEqual(["stable-ids"]);
		expect(
			checkPaginationCompleteness(first, [sale()]).map((entry) => entry.rule),
		).toEqual(["pagination"]);
	});

	it("checks window edges against single-day fetches", () => {
		const whole = [sale(), sale({ externalId: "T2" })];
		expect(
			checkWindowEdges(whole, [{ date: "2026-11-07", sales: whole }], true),
		).toEqual([]);
		expect(
			checkWindowEdges(whole, [{ date: "2026-11-07", sales: [] }], true).map(
				(entry) => entry.rule,
			),
		).toEqual(["window-edges", "window-edges"]);
	});
});

function adjustment(
	overrides: Partial<CanonicalAdjustment> = {},
): CanonicalAdjustment {
	return {
		kind: "voided",
		saleExternalId: "T1",
		occurredAt: new Date("2026-11-07T10:00:00.000Z"),
		amount: 45_000,
		reason: "Khách huỷ đơn",
		raw: null,
		...overrides,
	};
}

describe("adjustment checks", () => {
	it("accepts a void, an edit with its origin and a removed line", () => {
		const adjustments = [
			adjustment(),
			adjustment({
				kind: "edited",
				saleExternalId: "T2",
				relatedSaleExternalId: "T2-ORIGIN",
				amount: 10_000,
			}),
			adjustment({
				kind: "line_removed",
				saleExternalId: "T3",
				lineExternalId: "L1_REMOVE",
				itemExternalId: "DR-1",
				itemName: "Trà sữa (M)",
				quantity: 1,
			}),
		];
		expect(checkAdjustments(adjustments, context)).toEqual([]);
	});

	it("places occurredAt on the business date in the store timezone", () => {
		const lateEvening = adjustment({
			occurredAt: new Date("2026-11-07T16:30:00.000Z"),
		});
		expect(checkAdjustments([lateEvening], context)).toEqual([]);
		const nextLocalDay = adjustment({
			occurredAt: new Date("2026-11-07T17:30:00.000Z"),
		});
		expect(
			checkAdjustments([nextLocalDay], context).map((entry) => entry.rule),
		).toEqual(["adjustment-window"]);
	});

	it("rejects negative amounts, removed lines without a line or quantity, and unknown kinds", () => {
		expect(
			checkAdjustments([adjustment({ amount: -1 })], context).map(
				(entry) => entry.rule,
			),
		).toEqual(["adjustment-amount"]);
		expect(
			checkAdjustments([adjustment({ kind: "line_removed" })], context).map(
				(entry) => entry.rule,
			),
		).toEqual(["adjustment-line", "adjustment-line"]);
		expect(
			checkAdjustments(
				[
					adjustment({
						kind: "line_removed",
						lineExternalId: "L1_REMOVE",
						quantity: 0,
					}),
				],
				context,
			).map((entry) => entry.rule),
		).toEqual(["adjustment-schema", "adjustment-line"]);
		expect(
			checkAdjustments(
				[adjustment({ kind: "refunded" as CanonicalAdjustment["kind"] })],
				context,
			).map((entry) => entry.rule),
		).toEqual(["adjustment-schema", "adjustment-kind"]);
		expect(
			checkAdjustments([adjustment({ saleExternalId: "" })], context).map(
				(entry) => entry.rule,
			),
		).toEqual(["adjustment-schema", "adjustment-sale"]);
	});

	it("flags duplicates by kind, sale, line and time", () => {
		const first = adjustment({
			kind: "line_removed",
			lineExternalId: "L1_REMOVE",
			quantity: 1,
		});
		const otherLine = { ...first, lineExternalId: "L2_REMOVE" };
		expect(checkAdjustments([first, otherLine], context)).toEqual([]);
		expect(adjustmentKey(first)).not.toBe(adjustmentKey(otherLine));
		expect(
			checkAdjustments([first, { ...first }], context).map(
				(entry) => entry.rule,
			),
		).toEqual(["adjustment-duplicates"]);
	});
});
