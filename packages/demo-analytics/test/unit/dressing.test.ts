import { describe, expect, it } from "vitest";
import {
	DEMO_BILL_DISCOUNT_NAME,
	DEMO_CASHIERS,
	DEMO_ITEM_PROMOTION_NAME,
	DemoDayCache,
	demoCashierFor,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");

describe("demo dressing", () => {
	it("names promotions apart from their kind and rotates named cashiers", async () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.5 });
		const day = await days.generated("MOCK-S1", "2026-11-03");
		if (day === null) throw new Error("expected a generated day");
		const lineNames = new Set(
			day.sales.flatMap((sale) =>
				sale.lines.flatMap((line) =>
					line.promotionName === undefined ? [] : [line.promotionName],
				),
			),
		);
		expect([...lineNames]).toEqual([DEMO_ITEM_PROMOTION_NAME]);
		const week = await Promise.all(
			[
				"2026-10-28",
				"2026-10-29",
				"2026-10-30",
				"2026-10-31",
				"2026-11-01",
			].map((date) => days.generated("MOCK-S1", date)),
		);
		const billNames = new Set(
			[day, ...week].flatMap((entry) =>
				(entry?.sales ?? []).flatMap((sale) =>
					sale.billDiscountName === undefined ? [] : [sale.billDiscountName],
				),
			),
		);
		expect([...billNames]).toEqual([DEMO_BILL_DISCOUNT_NAME]);
		const cashiers = day.shifts.map((shift) => shift.cashierName);
		expect(new Set(cashiers).size).toBe(day.shifts.length);
		expect(cashiers).toEqual(
			day.shifts.map((_, index) => demoCashierFor("2026-11-03", index).name),
		);
		for (const sale of day.sales) {
			const shift = day.shifts.find(
				(entry) => entry.externalId === sale.shiftExternalId,
			);
			expect(sale.employeeName).toBe(shift?.cashierName);
		}
		expect(
			new Set(
				["2026-11-01", "2026-11-02", "2026-11-03"].map(
					(date) => demoCashierFor(date, 0).name,
				),
			).size,
		).toBe(DEMO_CASHIERS.length);
	});
});
