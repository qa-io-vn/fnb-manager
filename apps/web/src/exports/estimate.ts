import { readStoredJson, writeStoredJson } from "../lib/storage";
import {
	dayCount,
	type ExportPlan,
	type ExportTableId,
	type MonthKey,
	type MonthPlan,
	type StoreTableId,
} from "./plan";
import type { ControlTotals } from "./totals";

export const BYTES_PER_ROW: Readonly<Record<ExportTableId, number>> = {
	invoices: 910,
	invoice_lines: 585,
	invoice_payments: 175,
	shifts: 475,
	daily_summary: 820,
};

export const BYTES_PER_MEGABYTE = 1_000_000;
export const BYTES_PER_GIGABYTE = 1_000_000_000;
export const CONFIRM_ABOVE_BYTES = 100 * BYTES_PER_MEGABYTE;
export const FREE_PLAN_EGRESS_BYTES = 5 * BYTES_PER_GIGABYTE;
export const MAX_REPORT_ROWS = 900;
export const MONTHLY_TALLY_PREFIX = "fnb.export-bytes.";

export interface EstimateRow {
	readonly month: MonthKey;
	readonly storeId: string;
	readonly label: string;
	readonly rows: Readonly<Record<StoreTableId, number>>;
}

export interface ExportEstimate {
	readonly rows: readonly EstimateRow[];
	readonly dailySummaryRows: number;
	readonly totalRows: Readonly<Record<ExportTableId, number>>;
	readonly bytes: number;
	readonly needsConfirmation: boolean;
}

export function dailySummaryIncludesAll(
	month: Pick<MonthPlan, "from" | "to" | "storeMonths">,
): boolean {
	return (
		(month.storeMonths.length + 1) * dayCount(month.from, month.to) <=
		MAX_REPORT_ROWS
	);
}

export function dailySummaryRowCount(
	month: Pick<MonthPlan, "from" | "to" | "storeMonths">,
): number {
	const scopes = dailySummaryIncludesAll(month)
		? month.storeMonths.length + 1
		: month.storeMonths.length;
	return scopes * dayCount(month.from, month.to);
}

export function storeMonthKey(month: MonthKey, storeId: string): string {
	return `${month}|${storeId}`;
}

export function estimateExport(
	plan: ExportPlan,
	totals: ReadonlyMap<string, ControlTotals>,
): ExportEstimate {
	const rows: EstimateRow[] = [];
	const totalRows: Record<ExportTableId, number> = {
		invoices: 0,
		invoice_lines: 0,
		invoice_payments: 0,
		shifts: 0,
		daily_summary: 0,
	};
	for (const month of plan.months) {
		if (plan.dailySummary) {
			totalRows.daily_summary += dailySummaryRowCount(month);
		}
		for (const storeMonth of month.storeMonths) {
			const control = totals.get(
				storeMonthKey(month.month, storeMonth.store.id),
			);
			const counts: Record<StoreTableId, number> = {
				invoices: 0,
				invoice_lines: 0,
				invoice_payments: 0,
				shifts: 0,
			};
			for (const table of plan.storeTables) {
				counts[table] = control?.tables[table].rows ?? 0;
				totalRows[table] += counts[table];
			}
			rows.push({
				month: month.month,
				storeId: storeMonth.store.id,
				label: storeMonth.store.label,
				rows: counts,
			});
		}
	}
	const bytes = (Object.keys(totalRows) as ExportTableId[]).reduce(
		(sum, table) => sum + totalRows[table] * BYTES_PER_ROW[table],
		0,
	);
	return {
		rows,
		dailySummaryRows: totalRows.daily_summary,
		totalRows,
		bytes,
		needsConfirmation: needsConfirmation(bytes),
	};
}

export function needsConfirmation(bytes: number): boolean {
	return bytes > CONFIRM_ABOVE_BYTES;
}

export function megabytes(bytes: number): number {
	return bytes / BYTES_PER_MEGABYTE;
}

export function gigabytes(bytes: number): number {
	return bytes / BYTES_PER_GIGABYTE;
}

export function deviceMonth(now: Date): MonthKey {
	return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function monthlyTallyKey(month: MonthKey): string {
	return `${MONTHLY_TALLY_PREFIX}${month}`;
}

function tallyValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
		? value
		: undefined;
}

export function readMonthlyTally(month: MonthKey): number {
	return readStoredJson(monthlyTallyKey(month), tallyValue) ?? 0;
}

export function addToMonthlyTally(month: MonthKey, bytes: number): number {
	const total = readMonthlyTally(month) + bytes;
	writeStoredJson(monthlyTallyKey(month), total);
	return total;
}
