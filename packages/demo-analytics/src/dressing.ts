import type { GeneratedDay } from "@fnb/connector-mock";
import type { IsoDate } from "@fnb/reports";

export const DEMO_ITEM_PROMOTION_NAME = "Giảm 10% món";
export const DEMO_BILL_DISCOUNT_NAME = "Giảm 5% hóa đơn";

export interface DemoCashier {
	readonly externalId: string;
	readonly name: string;
}

export const DEMO_CASHIERS: readonly DemoCashier[] = [
	{ externalId: "E-01", name: "Lan" },
	{ externalId: "E-02", name: "Minh" },
	{ externalId: "E-03", name: "Hà" },
];

function dayNumber(date: IsoDate): number {
	return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

export function demoCashierFor(date: IsoDate, shiftIndex: number): DemoCashier {
	const index =
		(((dayNumber(date) + shiftIndex) % DEMO_CASHIERS.length) +
			DEMO_CASHIERS.length) %
		DEMO_CASHIERS.length;
	return DEMO_CASHIERS[index] as DemoCashier;
}

export function dressDemoDay(day: GeneratedDay): GeneratedDay {
	return dressFreshDemoDay({
		...day,
		shifts: day.shifts.map((shift) => ({ ...shift })),
		sales: day.sales.map((sale) => ({
			...sale,
			lines: sale.lines.map((line) => ({ ...line })),
		})),
	});
}

export function dressFreshDemoDay(day: GeneratedDay): GeneratedDay {
	const cashierByShift = new Map(
		day.shifts.map((shift, index) => [
			shift.externalId,
			demoCashierFor(day.date, index),
		]),
	);
	for (const shift of day.shifts) {
		const cashier = cashierByShift.get(shift.externalId);
		if (cashier === undefined) continue;
		shift.cashierExternalId = cashier.externalId;
		shift.cashierName = cashier.name;
	}
	for (const sale of day.sales) {
		const cashier =
			sale.shiftExternalId === undefined
				? undefined
				: cashierByShift.get(sale.shiftExternalId);
		if (cashier !== undefined) {
			sale.employeeExternalId = cashier.externalId;
			sale.employeeName = cashier.name;
		}
		if (sale.billDiscountName !== undefined) {
			sale.billDiscountName = DEMO_BILL_DISCOUNT_NAME;
		}
		for (const line of sale.lines) {
			if (line.promotionName !== undefined) {
				line.promotionName = DEMO_ITEM_PROMOTION_NAME;
			}
		}
	}
	return day;
}
