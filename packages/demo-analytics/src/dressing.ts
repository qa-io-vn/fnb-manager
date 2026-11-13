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
	const cashierByShift = new Map(
		day.shifts.map((shift, index) => [
			shift.externalId,
			demoCashierFor(day.date, index),
		]),
	);
	return {
		...day,
		shifts: day.shifts.map((shift) => {
			const cashier = cashierByShift.get(shift.externalId);
			return cashier === undefined
				? shift
				: {
						...shift,
						cashierExternalId: cashier.externalId,
						cashierName: cashier.name,
					};
		}),
		sales: day.sales.map((sale) => {
			const cashier =
				sale.shiftExternalId === undefined
					? undefined
					: cashierByShift.get(sale.shiftExternalId);
			return {
				...sale,
				...(cashier === undefined
					? {}
					: {
							employeeExternalId: cashier.externalId,
							employeeName: cashier.name,
						}),
				...(sale.billDiscountName === undefined
					? {}
					: { billDiscountName: DEMO_BILL_DISCOUNT_NAME }),
				lines: sale.lines.map((line) =>
					line.promotionName === undefined
						? line
						: { ...line, promotionName: DEMO_ITEM_PROMOTION_NAME },
				),
			};
		}),
	};
}
