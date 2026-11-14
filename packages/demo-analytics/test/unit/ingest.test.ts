import type { GeneratedDay } from "@fnb/connector-mock";
import type {
	CanonicalLine,
	CanonicalPayment,
	CanonicalSale,
	CanonicalShift,
} from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	aggregateStoreDay,
	DemoSettingsStore,
	demoRoles,
	demoSettings,
	demoStores,
	PAIR_SEPARATOR,
} from "../../src/index.js";

const DATE = "2026-11-03";
const [store] = demoStores("2026-11-03");

function line(
	externalId: string,
	overrides: Partial<CanonicalLine> &
		Pick<CanonicalLine, "itemName" | "netAmount">,
): CanonicalLine {
	return {
		externalId,
		lineKind: "item",
		baseName: overrides.itemName,
		quantity: 1,
		unitPrice: overrides.netAmount,
		grossAmount: overrides.netAmount,
		discountAmount: 0,
		raw: null,
		...overrides,
	};
}

function payment(methodExternalId: string, amount: number): CanonicalPayment {
	const names: Record<string, [string, CanonicalPayment["kind"]]> = {
		"PM-CASH": ["Tiền mặt", "cash"],
		"PM-BANK": ["Chuyển khoản", "bank_transfer"],
		"PM-EWALLET": ["Ví điện tử QR", "ewallet"],
	};
	const [methodName, kind] = names[methodExternalId] ?? ["?", "other"];
	return {
		methodExternalId,
		methodName,
		kind,
		amount,
		feeAmount: 0,
		raw: null,
	};
}

function sale(
	externalId: string,
	soldAt: string,
	overrides: Partial<CanonicalSale> &
		Pick<CanonicalSale, "lines" | "payments" | "grossAmount" | "netAmount">,
): CanonicalSale {
	return {
		externalId,
		soldAt: new Date(soldAt),
		businessDate: DATE,
		channel: "dine_in",
		guestCount: 0,
		itemDiscountAmount: 0,
		billDiscountAmount: 0,
		voucherAmount: 0,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		paidAmount: overrides.netAmount,
		status: "completed",
		raw: null,
		...overrides,
	};
}

function shift(
	externalId: string,
	openedAt: string,
	salesAmount: number,
	drawer: number,
): CanonicalShift {
	return {
		externalId,
		name: externalId.endsWith("S1") ? "Ca sáng" : "Ca tối",
		cashierName: "Thu ngân",
		openedAt: new Date(openedAt),
		salesAmount,
		ordersCount: 1,
		cashDrawerAmount: drawer,
		openingFloatAmount: 1_500_000,
		changedAfterClose: false,
		raw: null,
	};
}

const morning = "MOCK-S1-2026-11-03-S1";
const evening = "MOCK-S1-2026-11-03-S3";

const fixture: GeneratedDay = {
	date: DATE,
	sales: [
		sale("A", "2026-11-03T02:15:00.000Z", {
			shiftExternalId: morning,
			customerPhone: "0912345678",
			grossAmount: 68_000,
			netAmount: 68_000,
			lines: [
				line("A-L1", {
					itemExternalId: "DR-001-M",
					itemName: "Trà đào cam sả (M)",
					baseName: "Trà đào cam sả",
					sizeLabel: "M",
					itemTypeExternalId: "TYPE-001",
					itemTypeName: "Trà trái cây",
					netAmount: 45_000,
				}),
				line("A-L2", {
					itemExternalId: "TP-001",
					itemName: "Trân châu đen",
					itemTypeExternalId: "TYPE-007",
					itemTypeName: "Topping",
					parentLineExternalId: "A-L1",
					netAmount: 8_000,
				}),
				line("A-L3", {
					lineKind: "modifier",
					itemExternalId: "OPT-001",
					itemName: "0% Đường",
					itemTypeExternalId: "TYPE-010",
					itemTypeName: "Tuỳ chọn",
					parentLineExternalId: "A-L1",
					netAmount: 0,
				}),
				line("A-L4", {
					itemExternalId: "SN-001",
					itemName: "Hạt bí rang",
					itemTypeExternalId: "TYPE-009",
					itemTypeName: "Đồ ăn kèm",
					netAmount: 15_000,
				}),
			],
			payments: [payment("PM-CASH", 68_000)],
		}),
		sale("B", "2026-11-03T03:00:00.000Z", {
			status: "voided",
			shiftExternalId: morning,
			grossAmount: 90_000,
			netAmount: 90_000,
			lines: [
				line("B-L1", {
					itemExternalId: "DR-008-L",
					itemName: "Trà sữa truyền thống (L)",
					baseName: "Trà sữa truyền thống",
					sizeLabel: "L",
					itemTypeExternalId: "TYPE-002",
					quantity: 2,
					netAmount: 90_000,
				}),
			],
			payments: [payment("PM-EWALLET", 90_000)],
		}),
		sale("C", "2026-11-03T16:58:00.000Z", {
			status: "edited",
			shiftExternalId: evening,
			grossAmount: 106_000,
			itemDiscountAmount: 8_000,
			billDiscountAmount: 5_000,
			billDiscountName: "Giảm giá hoá đơn",
			voucherAmount: 10_000,
			voucherCode: "VC-10K",
			voucherName: "Voucher 10k",
			netAmount: 83_000,
			lines: [
				line("C-L1", {
					itemExternalId: "DR-008-M",
					itemName: "Trà sữa truyền thống (M)",
					baseName: "Trà sữa truyền thống",
					sizeLabel: "M",
					itemTypeExternalId: "TYPE-002",
					itemTypeName: "Trà sữa",
					quantity: 2,
					grossAmount: 76_000,
					discountAmount: 8_000,
					promotionExternalId: "PROMO-04",
					promotionName: "Giảm giá món",
					netAmount: 68_000,
				}),
				line("C-L2", {
					itemExternalId: "DR-015",
					itemName: "Cà phê đen",
					itemTypeExternalId: "TYPE-003",
					itemTypeName: "Cà phê",
					netAmount: 30_000,
				}),
			],
			payments: [payment("PM-CASH", 40_000), payment("PM-BANK", 43_000)],
		}),
	],
	shifts: [
		shift(morning, "2026-11-02T23:30:00.000Z", 68_000, 1_573_000),
		shift(evening, "2026-11-03T10:30:00.000Z", 83_000, 1_530_000),
	],
	adjustments: [
		{
			kind: "voided",
			saleExternalId: "B",
			occurredAt: new Date("2026-11-03T03:05:00.000Z"),
			amount: 90_000,
			raw: null,
		},
		{
			kind: "line_removed",
			saleExternalId: "C",
			lineExternalId: "C-L2",
			occurredAt: new Date("2026-11-03T17:08:00.000Z"),
			amount: 30_000,
			raw: null,
		},
	],
	dailyTotal: {
		businessDate: DATE,
		invoiceCount: 2,
		grossAmount: 174_000,
		discountAmount: 13_000,
		voucherAmount: 10_000,
		netAmount: 151_000,
		raw: null,
	},
};

describe("aggregateStoreDay", () => {
	if (store === undefined) throw new Error("missing demo store");
	const day = aggregateStoreDay(store, fixture);

	it("writes the daily row the refresh writes", () => {
		expect(day.daily).toEqual({
			invoices: 2,
			grossMinor: 17_400_000,
			itemDiscountMinor: 800_000,
			billDiscountMinor: 500_000,
			voucherMinor: 1_000_000,
			netMinor: 15_100_000,
			paidMinor: 15_100_000,
			cashMinor: 10_800_000,
			itemsMilli: 6_000,
			modifierLines: 1,
			voucherInvoices: 1,
			memberInvoices: 1,
			identifiedInvoices: 1,
			voidedInvoices: 1,
			voidedMinor: 9_000_000,
			editedInvoices: 1,
		});
	});

	it("buckets non-voided sales by the local hour", () => {
		expect(day.hourly).toEqual([
			{ hour: 9, invoices: 1, netMinor: 6_800_000, itemsMilli: 3_000 },
			{ hour: 23, invoices: 1, netMinor: 8_300_000, itemsMilli: 3_000 },
		]);
	});

	it("aggregates items, sizes and payments without voided sales or modifiers", () => {
		expect(
			Object.fromEntries(
				day.items.map((item) => [
					item.itemExternalId,
					[item.quantityMilli, item.netMinor, item.invoices],
				]),
			),
		).toEqual({
			"DR-001-M": [1_000, 4_500_000, 1],
			"TP-001": [1_000, 800_000, 1],
			"SN-001": [1_000, 1_500_000, 1],
			"DR-008-M": [2_000, 6_800_000, 1],
			"DR-015": [1_000, 3_000_000, 1],
		});
		expect(day.sizes).toEqual([
			{
				baseName: "Trà đào cam sả",
				sizeLabel: "M",
				quantityMilli: 1_000,
				netMinor: 4_500_000,
			},
			{
				baseName: "Trà sữa truyền thống",
				sizeLabel: "M",
				quantityMilli: 2_000,
				netMinor: 6_800_000,
			},
		]);
		expect(day.payments).toEqual([
			{
				methodExternalId: "PM-CASH",
				methodName: "Tiền mặt",
				kind: "cash",
				invoices: 2,
				amountMinor: 10_800_000,
				feeMinor: 0,
				feeEstimateMinor: 0,
			},
			{
				methodExternalId: "PM-BANK",
				methodName: "Chuyển khoản",
				kind: "bank_transfer",
				invoices: 1,
				amountMinor: 4_300_000,
				feeMinor: 0,
				feeEstimateMinor: 0,
			},
		]);
	});

	it("counts attach rates over invoices with a drink", () => {
		expect(day.attach).toMatchObject({
			drinkInvoices: 2,
			toppingInvoices: 1,
			snackInvoices: 1,
			toppingLines: 1,
			snackLines: 1,
		});
		expect(day.attach?.attachRateTopping?.toString()).toBe("0.500000");
		expect(day.attach?.attachRateSnack?.toString()).toBe("0.500000");
	});

	it("reconciles each shift's drawer with its cash sales", () => {
		expect(
			day.shifts.map((item) => [
				item.shiftExternalId,
				item.businessDate,
				item.cashSalesMinor,
				item.expectedCashMinor,
				item.varianceMinor,
			]),
		).toEqual([
			[morning, DATE, 6_800_000, 156_800_000, 500_000],
			[evening, DATE, 4_000_000, 154_000_000, -1_000_000],
		]);
	});

	it("records the three kinds of promotion use and the removed line of the next day", () => {
		expect(day.promotions).toEqual([
			{
				kind: "item",
				key: "PROMO-04",
				name: "Giảm giá món",
				invoices: 1,
				lines: 1,
				discountMinor: 800_000,
			},
			{
				kind: "bill",
				key: "Giảm giá hoá đơn",
				name: "Giảm giá hoá đơn",
				invoices: 1,
				lines: 0,
				discountMinor: 500_000,
			},
			{
				kind: "voucher",
				key: "Voucher 10k",
				name: "Voucher 10k",
				invoices: 1,
				lines: 0,
				discountMinor: 1_000_000,
			},
		]);
		expect(day.itemLines).toBe(5);
		expect([...day.removedLinesByDate.entries()]).toEqual([["2026-11-04", 1]]);
	});
});

describe("aggregateStoreDay with the settings' mappings", () => {
	if (store === undefined) throw new Error("missing demo store");

	it("counts each unordered item pair once per invoice, in byte order", () => {
		const day = aggregateStoreDay(store, fixture);
		expect(day.invoicesWithItems).toBe(2);
		expect(
			[...day.pairs.entries()].map(([key, count]) => [
				key.split(PAIR_SEPARATOR).join("+"),
				count,
			]),
		).toEqual([
			["DR-001-M+SN-001", 1],
			["DR-001-M+TP-001", 1],
			["SN-001+TP-001", 1],
			["DR-008-M+DR-015", 1],
		]);
	});

	it("records each drink's invoices with a topping and with a snack", () => {
		const day = aggregateStoreDay(store, fixture);
		expect(day.drinks).toEqual([
			{
				itemExternalId: "DR-001-M",
				itemName: "Trà đào cam sả (M)",
				drinkInvoices: 1,
				toppingInvoices: 1,
				snackInvoices: 1,
			},
			{
				itemExternalId: "DR-008-M",
				itemName: "Trà sữa truyền thống (M)",
				drinkInvoices: 1,
				toppingInvoices: 0,
				snackInvoices: 0,
			},
			{
				itemExternalId: "DR-015",
				itemName: "Cà phê đen",
				drinkInvoices: 1,
				toppingInvoices: 0,
				snackInvoices: 0,
			},
		]);
	});

	it("follows a category override of the store's POS account", () => {
		const settings = new DemoSettingsStore(demoSettings());
		settings.saveOverrides([
			{
				posAccountId: settings.accountOf(store.id),
				itemExternalId: "SN-001",
				itemTypeExternalId: "TYPE-001",
				itemTypeName: "Trà trái cây",
			},
		]);
		expect(settings.ingestVersion).toBe(1);
		const day = aggregateStoreDay(store, fixture, settings);
		expect(day.attach).toMatchObject({
			drinkInvoices: 2,
			toppingInvoices: 1,
			snackInvoices: 0,
			snackLines: 0,
		});
		expect(day.drinks.map((drink) => drink.itemExternalId)).toEqual([
			"DR-001-M",
			"SN-001",
			"DR-008-M",
			"DR-015",
		]);
		expect(
			day.items.find((item) => item.itemExternalId === "SN-001"),
		).toMatchObject({
			itemTypeExternalId: "TYPE-009",
		});
	});

	it("measures no topping rate at a store whose account maps no topping", () => {
		const settings = new DemoSettingsStore(demoSettings());
		settings.saveStoreAccounts({ [store.id]: "second-account" });
		settings.saveRoles([
			...demoRoles(),
			{
				posAccountId: "second-account",
				itemTypeExternalId: "TYPE-001",
				role: "drink",
			},
			{
				posAccountId: "second-account",
				itemTypeExternalId: "TYPE-002",
				role: "drink",
			},
			{
				posAccountId: "second-account",
				itemTypeExternalId: "TYPE-003",
				role: "drink",
			},
			{
				posAccountId: "second-account",
				itemTypeExternalId: "TYPE-009",
				role: "snack",
			},
		]);
		const day = aggregateStoreDay(store, fixture, settings);
		expect(day.attach).toMatchObject({
			drinkInvoices: 2,
			toppingInvoices: 0,
			snackInvoices: 1,
			attachRateTopping: null,
		});
		expect(day.attach?.attachRateSnack?.toString()).toBe("0.500000");
		expect(settings.rolesConfigured(store.id)).toBe(true);
		expect(settings.rolesConfigured("MOCK-S2")).toBe(true);
	});
});
