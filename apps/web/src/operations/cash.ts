import type { CashCountRow } from "./source";

export interface CashSummary {
	readonly closed: number;
	readonly counted: number;
	readonly over: number;
	readonly missing: number;
	readonly unmatched: number;
}

export function isClosedShift(row: CashCountRow): boolean {
	return row.shiftId !== null && row.closedAt !== null;
}

export function cashSummary(rows: readonly CashCountRow[]): CashSummary {
	const closed = rows.filter(isClosedShift);
	return {
		closed: closed.length,
		counted: closed.filter((row) => row.cashCountId !== null).length,
		over: rows.filter((row) => row.state === "over").length,
		missing: closed.filter((row) => row.state === "no_count").length,
		unmatched: rows.filter((row) => row.state === "unmatched").length,
	};
}

export function shiftsWithoutCount(
	rows: readonly CashCountRow[],
): CashCountRow[] {
	return rows.filter((row) => isClosedShift(row) && row.state === "no_count");
}

export function reopenableCounts(
	rows: readonly CashCountRow[],
): CashCountRow[] {
	return rows.filter((row) => row.cashCountId !== null);
}

export function isOverLimit(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "22023"
	);
}
