import { addMonths, firstOfMonth, type IsoDate } from "@fnb/reports";
import { reportHref } from "../../reports/report-route";
import type { NumberDraft } from "../number-text";
import type { Membership } from "../source";
import type { ValidationIssue } from "../validation";
import type { TargetChange, TargetRow } from "./source";

export const TARGET_MONTHS_BACK = 3;
export const TARGET_MONTHS_AHEAD = 2;
export const MONTHLY = "month";

export type TargetDraft = Readonly<Record<IsoDate, string>>;

export interface TargetReading {
	readonly changes: readonly TargetChange[];
	readonly pendingCount: number;
	readonly invalid: boolean;
	readonly issues: ReadonlyMap<IsoDate, ValidationIssue>;
}

export interface TargetDraftContext {
	readonly storeId: string;
	readonly rows: readonly TargetRow[];
	readonly readAmount: (text: string) => NumberDraft;
}

interface TargetStore {
	readonly id: string;
}

export function targetMonthsOf(today: IsoDate): IsoDate[] {
	const current = firstOfMonth(today);
	return Array.from(
		{ length: TARGET_MONTHS_BACK + TARGET_MONTHS_AHEAD + 1 },
		(_, index) => addMonths(current, index - TARGET_MONTHS_BACK),
	);
}

export function monthTargetOf(
	rows: readonly TargetRow[],
	storeId: string,
	monthStart: IsoDate,
): TargetRow | null {
	return (
		rows.find(
			(row) =>
				row.storeId === storeId &&
				row.periodKind === MONTHLY &&
				row.periodStart === monthStart,
		) ?? null
	);
}

export function defaultTargetStore(
	membership: Membership | null | undefined,
	stores: readonly TargetStore[],
): string | null {
	const limited = membership?.storeIds ?? null;
	const writes = membership?.role === "owner" || membership?.role === "manager";
	const own =
		limited !== null && writes
			? stores.find((store) => limited.includes(store.id))
			: undefined;
	return own?.id ?? stores[0]?.id ?? null;
}

export function readTargetEdits(
	draft: TargetDraft,
	{ storeId, rows, readAmount }: TargetDraftContext,
): TargetReading {
	const changes: TargetChange[] = [];
	const issues = new Map<IsoDate, ValidationIssue>();
	for (const [monthStart, text] of Object.entries(draft)) {
		const saved =
			monthTargetOf(rows, storeId, monthStart)?.netTargetAmount ?? null;
		if (text.trim() === "") {
			if (saved !== null) issues.set(monthStart, { key: "required" });
			continue;
		}
		const amount = readAmount(text);
		if (amount.issue !== null || amount.value === null) {
			issues.set(monthStart, amount.issue ?? { key: "number" });
			continue;
		}
		if (amount.value === saved) continue;
		changes.push({
			storeId,
			periodKind: MONTHLY,
			periodStart: monthStart,
			netTargetAmount: amount.value,
		});
	}
	return {
		changes,
		pendingCount: changes.length + issues.size,
		invalid: issues.size > 0,
		issues,
	};
}

export function withoutSavedTargets(
	draft: TargetDraft,
	saved: readonly TargetChange[],
): TargetDraft {
	const savedMonths = new Set(saved.map((change) => change.periodStart));
	return Object.fromEntries(
		Object.entries(draft).filter(
			([monthStart]) => !savedMonths.has(monthStart),
		),
	);
}

function targetKeyOf(
	row: Pick<TargetChange, "storeId" | "periodKind" | "periodStart">,
): string {
	return `${row.storeId}|${row.periodKind}|${row.periodStart}`;
}

export function withSavedTargets(
	previous: readonly TargetRow[] | undefined,
	saved: readonly TargetRow[],
): TargetRow[] | undefined {
	if (previous === undefined) return previous;
	const savedByKey = new Map(saved.map((row) => [targetKeyOf(row), row]));
	const kept = previous.map((row) => {
		const replaced = savedByKey.get(targetKeyOf(row));
		if (replaced === undefined) return row;
		savedByKey.delete(targetKeyOf(row));
		return replaced;
	});
	return [...kept, ...savedByKey.values()];
}

export function monthKeyOf(monthStart: IsoDate): string {
	return monthStart.slice(0, 7);
}

export function monthReportPath(monthStart: IsoDate, storeId: string): string {
	return reportHref("month", { key: monthKeyOf(monthStart) }, [storeId]);
}

export function shareOfTarget(
	amount: number | null,
	target: number | null,
): number | null {
	if (amount === null || target === null || target <= 0) return null;
	return amount / target;
}
