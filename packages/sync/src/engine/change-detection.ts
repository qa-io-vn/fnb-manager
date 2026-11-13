import type { CanonicalDailyTotal } from "@fnb/core";
import { formatMoney, parseNumeric } from "../numeric.js";
import type { LocalDayTotal, SyncCheckRow } from "../rows.js";
import {
	type CheckTolerance,
	type DayTotals,
	DEFAULT_CHECK_TOLERANCE,
	totalsMatch,
} from "./checks.js";

export const DAY_REASONS = [
	"unchecked",
	"unmatched",
	"pos_changed",
	"local_changed",
	"unchanged",
] as const;

export type DayReason = (typeof DAY_REASONS)[number];

export interface DayDecision {
	date: string;
	reason: DayReason;
	pull: boolean;
	posInvoiceCount: number;
}

export interface ChangeDetectionInput {
	dates: readonly string[];
	controlTotals: readonly CanonicalDailyTotal[];
	storedChecks: readonly SyncCheckRow[];
	localTotals: readonly LocalDayTotal[];
	tolerance?: CheckTolerance;
}

function posTotalsByDate(
	totals: readonly CanonicalDailyTotal[],
): Map<string, DayTotals> {
	const byDate = new Map<string, DayTotals>();
	for (const total of totals) {
		const previous = byDate.get(total.businessDate);
		byDate.set(total.businessDate, {
			invoiceCount: (previous?.invoiceCount ?? 0) + total.invoiceCount,
			netAmount: (previous?.netAmount ?? 0) + total.netAmount,
		});
	}
	return byDate;
}

function sameAsChecked(pos: DayTotals, check: SyncCheckRow): boolean {
	return (
		pos.invoiceCount === check.source_invoice_count &&
		formatMoney(pos.netAmount) ===
			formatMoney(parseNumeric(check.source_net_amount))
	);
}

function reasonFor(
	pos: DayTotals,
	check: SyncCheckRow | undefined,
	local: DayTotals,
	tolerance: CheckTolerance,
): DayReason {
	if (!check) {
		return "unchecked";
	}
	if (!check.is_matched) {
		return "unmatched";
	}
	if (!sameAsChecked(pos, check)) {
		return "pos_changed";
	}
	return totalsMatch(pos, local, tolerance) ? "unchanged" : "local_changed";
}

export function detectChangedDays(input: ChangeDetectionInput): DayDecision[] {
	const tolerance = input.tolerance ?? DEFAULT_CHECK_TOLERANCE;
	const pos = posTotalsByDate(input.controlTotals);
	const checks = new Map(
		input.storedChecks.map((check) => [check.business_date, check]),
	);
	const local = new Map(
		input.localTotals.map((total) => [
			total.business_date,
			{
				invoiceCount: total.invoice_count,
				netAmount: parseNumeric(total.net_amount),
			},
		]),
	);
	return input.dates.map((date) => {
		const posDay = pos.get(date) ?? { invoiceCount: 0, netAmount: 0 };
		const reason = reasonFor(
			posDay,
			checks.get(date),
			local.get(date) ?? { invoiceCount: 0, netAmount: 0 },
			tolerance,
		);
		return {
			date,
			reason,
			pull: reason !== "unchanged",
			posInvoiceCount: posDay.invoiceCount,
		};
	});
}
