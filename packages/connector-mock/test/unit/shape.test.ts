import { type CanonicalSale, wallClockIn } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_MOCK_PROFILE,
	generateDays,
	hashSeed,
	MENU,
	mulberry32,
} from "../../src/index.js";

const EIGHT_WEEKS = { fromDate: "2026-09-01", toDate: "2026-10-26" };
const data = generateDays(
	7,
	DEFAULT_MOCK_PROFILE,
	EIGHT_WEEKS.fromDate,
	EIGHT_WEEKS.toDate,
);
const counted = data.sales.filter((sale) => sale.status !== "voided");
const totalNet = counted.reduce((sum, sale) => sum + sale.netAmount, 0);

function share(predicate: (sale: CanonicalSale) => boolean): number {
	return (
		counted.filter(predicate).reduce((sum, sale) => sum + sale.netAmount, 0) /
		totalNet
	);
}

describe("mulberry32", () => {
	it("is deterministic and uniform-ish", () => {
		const first = mulberry32(123);
		const second = mulberry32(123);
		const draws = Array.from({ length: 5 }, () => first.next());
		expect(Array.from({ length: 5 }, () => second.next())).toEqual(draws);
		const mean =
			Array.from({ length: 2_000 }, () => first.next()).reduce(
				(sum, value) => sum + value,
				0,
			) / 2_000;
		expect(mean).toBeGreaterThan(0.45);
		expect(mean).toBeLessThan(0.55);
		expect(hashSeed(1, "a")).not.toBe(hashSeed(1, "b"));
	});
});

describe("menu", () => {
	it("has about forty drinks in six categories with M and L sizes", () => {
		const bases = new Set(MENU.drinks.map((drink) => drink.baseName));
		expect(bases.size).toBe(40);
		expect(new Set(MENU.drinks.map((drink) => drink.itemTypeName)).size).toBe(
			6,
		);
		for (const base of bases) {
			const sizes = MENU.drinks.filter((drink) => drink.baseName === base);
			const medium = sizes.find((drink) => drink.sizeLabel === "M");
			const large = sizes.find((drink) => drink.sizeLabel === "L");
			if (medium && large) {
				expect(large.listPrice - medium.listPrice).toBeGreaterThanOrEqual(
					5_000,
				);
				expect(large.listPrice - medium.listPrice).toBeLessThanOrEqual(10_000);
			}
		}
		expect(MENU.catalog.items.filter((item) => item.isModifier).length).toBe(9);
		expect(MENU.toppings.length).toBeGreaterThan(0);
		expect(MENU.snacks.length).toBeGreaterThan(0);
	});
});

describe("generated shape", () => {
	it("peaks in the evening with a dead zone at 17-18h", () => {
		const hourOf = (sale: CanonicalSale) =>
			wallClockIn(sale.soldAt, DEFAULT_MOCK_PROFILE.timezone).hour;
		const evening = share((sale) => [20, 21].includes(hourOf(sale)));
		const morning = share((sale) => [8, 9, 10].includes(hourOf(sale)));
		const dead = share((sale) => [17, 18].includes(hourOf(sale)));
		expect(evening).toBeGreaterThan(0.3);
		expect(evening).toBeLessThan(0.4);
		expect(morning).toBeGreaterThan(0.15);
		expect(dead).toBeLessThan(0.06);
	});

	it("is Fri-Sun heavy", () => {
		const weekday = (sale: CanonicalSale) =>
			new Date(`${sale.businessDate}T00:00:00Z`).getUTCDay();
		const weekend = share((sale) => [0, 5, 6].includes(weekday(sale)));
		expect(weekend).toBeGreaterThan(0.5);
		expect(weekend).toBeLessThan(0.62);
	});

	it("has an average ticket around 80-100k with 1-3 item lines", () => {
		const ticket = totalNet / counted.length;
		expect(ticket).toBeGreaterThan(75_000);
		expect(ticket).toBeLessThan(105_000);
		for (const sale of counted) {
			const drinkLines = sale.lines.filter(
				(line) =>
					line.lineKind === "item" &&
					line.itemExternalId?.startsWith("DR-") === true,
			);
			expect(drinkLines.length).toBeGreaterThanOrEqual(1);
			expect(drinkLines.length).toBeLessThanOrEqual(3);
		}
	});

	it("attaches zero-amount sugar and ice modifiers to drinks", () => {
		const lines = counted.flatMap((sale) => sale.lines);
		const modifiers = lines.filter((line) => line.lineKind === "modifier");
		const drinks = lines.filter(
			(line) => line.itemExternalId?.startsWith("DR-") === true,
		);
		expect(modifiers.length / drinks.length).toBeGreaterThan(0.15);
		expect(modifiers.length / drinks.length).toBeLessThan(0.25);
		for (const modifier of modifiers) {
			expect(modifier.netAmount).toBe(0);
			expect(modifier.parentLineExternalId).toBeDefined();
			expect(modifier.itemName).toMatch(/Đường|Đá/u);
		}
	});

	it("mixes payments roughly 55/25/20 and splits a few bills", () => {
		const payments = counted.flatMap((sale) => sale.payments);
		const byKind = (kind: string) =>
			payments.filter((payment) => payment.kind === kind).length /
			payments.length;
		expect(byKind("ewallet")).toBeGreaterThan(0.48);
		expect(byKind("ewallet")).toBeLessThan(0.62);
		expect(byKind("cash")).toBeGreaterThan(0.18);
		expect(byKind("cash")).toBeLessThan(0.32);
		expect(byKind("bank_transfer")).toBeGreaterThan(0.13);
		expect(byKind("bank_transfer")).toBeLessThan(0.27);
		expect(counted.some((sale) => sale.payments.length === 2)).toBe(true);
		expect(
			counted.some(
				(sale) =>
					sale.payments.length === 2 &&
					sale.payments[0]?.methodExternalId ===
						sale.payments[1]?.methodExternalId,
			),
		).toBe(true);
	});

	it("places one sale in the first and one in the last minute of every business day", () => {
		const dates = new Set(data.sales.map((sale) => sale.businessDate));
		for (const date of dates) {
			const minutes = data.sales
				.filter((sale) => sale.businessDate === date)
				.map((sale) => {
					const wall = wallClockIn(sale.soldAt, DEFAULT_MOCK_PROFILE.timezone);
					return wall.hour * 60 + wall.minute;
				});
			expect(minutes).toContain(0);
			expect(minutes).toContain(23 * 60 + 59);
		}
		const quiet = generateDays(
			7,
			{ ...DEFAULT_MOCK_PROFILE, boundarySales: false },
			"2026-09-01",
			"2026-09-07",
		);
		expect(
			quiet.sales.some(
				(sale) =>
					wallClockIn(sale.soldAt, DEFAULT_MOCK_PROFILE.timezone).hour === 0,
			),
		).toBe(false);
	});

	it("puts vouchers on about a tenth of sales and no customers by default", () => {
		const voucherShare =
			counted.filter((sale) => sale.voucherAmount > 0).length / counted.length;
		expect(voucherShare).toBeGreaterThan(0.07);
		expect(voucherShare).toBeLessThan(0.13);
		expect(counted.every((sale) => sale.customerPhone === undefined)).toBe(
			true,
		);
		expect(counted.every((sale) => sale.guestCount === 0)).toBe(true);
	});

	it("emits three shifts per day whose drawers follow the opening float plus cash", () => {
		const days = new Set(data.sales.map((sale) => sale.businessDate)).size;
		expect(data.shifts.length).toBe(days * 3);
		const exact = data.shifts.filter((shift) => {
			const cash = counted
				.filter((sale) => sale.shiftExternalId === shift.externalId)
				.flatMap((sale) => sale.payments)
				.filter((payment) => payment.kind === "cash")
				.reduce((sum, payment) => sum + payment.amount, 0);
			return shift.cashDrawerAmount === (shift.openingFloatAmount ?? 0) + cash;
		});
		expect(exact.length / data.shifts.length).toBeGreaterThan(0.8);
		for (const shift of data.shifts) {
			expect(shift.ordersCount).toBe(
				counted.filter((sale) => sale.shiftExternalId === shift.externalId)
					.length,
			);
		}
	});

	it("emits voids and edits as adjustments that reference emitted sales", () => {
		const ids = new Set(data.sales.map((sale) => sale.externalId));
		expect(data.adjustments.length).toBeGreaterThan(0);
		for (const adjustment of data.adjustments) {
			expect(ids.has(adjustment.saleExternalId)).toBe(true);
		}
		const voided = data.sales.filter((sale) => sale.status === "voided");
		expect(voided.length).toBe(
			data.adjustments.filter((adjustment) => adjustment.kind === "voided")
				.length,
		);
	});

	it("computes control totals from its own sales", () => {
		for (const total of data.dailyTotals) {
			const daySales = counted.filter(
				(sale) => sale.businessDate === total.businessDate,
			);
			expect(total.invoiceCount).toBe(daySales.length);
			expect(total.netAmount).toBe(
				daySales.reduce((sum, sale) => sum + sale.netAmount, 0),
			);
		}
	});
});

describe("determinism", () => {
	it("reproduces the same data for the same seed and differs for another", () => {
		const again = generateDays(
			7,
			DEFAULT_MOCK_PROFILE,
			"2026-09-01",
			"2026-09-03",
		);
		expect(again.sales).toEqual(
			data.sales.filter((sale) => sale.businessDate <= "2026-09-03"),
		);
		const other = generateDays(
			8,
			DEFAULT_MOCK_PROFILE,
			"2026-09-01",
			"2026-09-03",
		);
		expect(other.sales.map((sale) => sale.netAmount)).not.toEqual(
			again.sales.map((sale) => sale.netAmount),
		);
	});

	it("honours a configurable customer capture rate and day start", () => {
		const captured = generateDays(
			3,
			{ ...DEFAULT_MOCK_PROFILE, customerCaptureRate: 1, guestCountRate: 1 },
			"2026-09-01",
			"2026-09-01",
		);
		expect(
			captured.sales.every((sale) => sale.customerPhone !== undefined),
		).toBe(true);
		expect(captured.sales.every((sale) => sale.guestCount > 0)).toBe(true);
		const late = generateDays(
			3,
			{ ...DEFAULT_MOCK_PROFILE, dayStartMinutes: 5 * 60 },
			"2026-09-01",
			"2026-09-01",
		);
		expect(late.sales.every((sale) => sale.businessDate === "2026-09-01")).toBe(
			true,
		);
	});
});
