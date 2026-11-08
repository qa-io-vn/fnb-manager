import type { CanonicalDailyTotal } from "@fnb/core";
import { formatMoney, parseNumeric } from "../numeric.js";
import type { LocalDayTotal, SaleWrite } from "../rows.js";

export function controlCounts(
	totals: readonly CanonicalDailyTotal[] | null,
): Map<string, number> | null {
	if (!totals) {
		return null;
	}
	const counts = new Map<string, number>();
	for (const total of totals) {
		counts.set(
			total.businessDate,
			(counts.get(total.businessDate) ?? 0) + total.invoiceCount,
		);
	}
	return counts;
}

export function confirmsEmptyDay(
	counts: ReadonlyMap<string, number> | null,
	date: string,
): boolean {
	return counts !== null && (counts.get(date) ?? 0) === 0;
}

export function projectedTotals(
	byDate: ReadonlyMap<string, readonly SaleWrite[]>,
): LocalDayTotal[] {
	return [...byDate.entries()].map(([date, sales]) => {
		const counted = sales.filter((sale) => sale.invoice.status !== "voided");
		return {
			business_date: date,
			invoice_count: counted.length,
			net_amount: formatMoney(
				counted.reduce(
					(sum, sale) => sum + parseNumeric(sale.invoice.net_amount),
					0,
				),
			),
		};
	});
}
