import type { CanonicalDailyTotal } from "@fnb/core";
import { formatMoney, parseNumeric } from "../numeric.js";
import type { LocalDayTotal, SyncCheckRow } from "../rows.js";

export interface CheckTolerance {
	absolute: number;
	relative: number;
}

export const DEFAULT_CHECK_TOLERANCE: CheckTolerance = {
	absolute: 1_000,
	relative: 0.0005,
};

export interface DayTotals {
	invoiceCount: number;
	netAmount: number;
}

export function allowedDifference(
	sourceNetAmount: number,
	tolerance: CheckTolerance = DEFAULT_CHECK_TOLERANCE,
): number {
	return Math.max(
		tolerance.absolute,
		Math.abs(sourceNetAmount) * tolerance.relative,
	);
}

export function totalsMatch(
	source: DayTotals,
	local: DayTotals,
	tolerance: CheckTolerance = DEFAULT_CHECK_TOLERANCE,
): boolean {
	return (
		source.invoiceCount === local.invoiceCount &&
		Math.abs(source.netAmount - local.netAmount) <=
			allowedDifference(source.netAmount, tolerance)
	);
}

export interface CheckContext {
	tenantId: string;
	storeId: string;
	tolerance: CheckTolerance;
}

export function buildChecks(
	dates: readonly string[],
	controlTotals: readonly CanonicalDailyTotal[],
	localTotals: readonly LocalDayTotal[],
	context: CheckContext,
): SyncCheckRow[] {
	const sourceByDate = new Map<string, DayTotals>();
	for (const total of controlTotals) {
		const previous = sourceByDate.get(total.businessDate);
		sourceByDate.set(total.businessDate, {
			invoiceCount: (previous?.invoiceCount ?? 0) + total.invoiceCount,
			netAmount: (previous?.netAmount ?? 0) + total.netAmount,
		});
	}
	const localByDate = new Map(
		localTotals.map((total) => [
			total.business_date,
			{
				invoiceCount: total.invoice_count,
				netAmount: parseNumeric(total.net_amount),
			},
		]),
	);
	return dates.map((date) => {
		const source = sourceByDate.get(date) ?? { invoiceCount: 0, netAmount: 0 };
		const local = localByDate.get(date) ?? { invoiceCount: 0, netAmount: 0 };
		return {
			tenant_id: context.tenantId,
			store_id: context.storeId,
			business_date: date,
			source_invoice_count: source.invoiceCount,
			source_net_amount: formatMoney(source.netAmount),
			local_invoice_count: local.invoiceCount,
			local_net_amount: formatMoney(local.netAmount),
			is_matched: totalsMatch(source, local, context.tolerance),
		};
	});
}
