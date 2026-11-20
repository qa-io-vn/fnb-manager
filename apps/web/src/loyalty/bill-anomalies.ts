import type { MessageKey } from "../i18n";
import {
	BILL_ANOMALY_FLAGS,
	type BillAnomalyFlag,
	type BillAnomalyRow,
	type LoyaltyStoreSettings,
} from "./source";

export interface FlagWords {
	readonly labelKey: MessageKey;
	readonly explainKey: MessageKey;
}

export const BILL_FLAG_KEYS: Readonly<Record<BillAnomalyFlag, FlagWords>> = {
	peer_outlier: {
		labelKey: "loyalty.billAnomalies.flag.peer_outlier",
		explainKey: "loyalty.billAnomalies.flag.peer_outlier.explain",
	},
	disagreements: {
		labelKey: "loyalty.billAnomalies.flag.disagreements",
		explainKey: "loyalty.billAnomalies.flag.disagreements.explain",
	},
	disputes: {
		labelKey: "loyalty.billAnomalies.flag.disputes",
		explainKey: "loyalty.billAnomalies.flag.disputes.explain",
	},
	timeouts: {
		labelKey: "loyalty.billAnomalies.flag.timeouts",
		explainKey: "loyalty.billAnomalies.flag.timeouts.explain",
	},
	one_member: {
		labelKey: "loyalty.billAnomalies.flag.one_member",
		explainKey: "loyalty.billAnomalies.flag.one_member.explain",
	},
	amount_outliers: {
		labelKey: "loyalty.billAnomalies.flag.amount_outliers",
		explainKey: "loyalty.billAnomalies.flag.amount_outliers.explain",
	},
	audit_failed: {
		labelKey: "loyalty.billAnomalies.flag.audit_failed",
		explainKey: "loyalty.billAnomalies.flag.audit_failed.explain",
	},
	burst: {
		labelKey: "loyalty.billAnomalies.flag.burst",
		explainKey: "loyalty.billAnomalies.flag.burst.explain",
	},
};

export const OTHER_FLAG_KEYS: FlagWords = {
	labelKey: "loyalty.billAnomalies.flag.other",
	explainKey: "loyalty.billAnomalies.flag.other.explain",
};

export function isKnownFlag(flag: string): flag is BillAnomalyFlag {
	return (BILL_ANOMALY_FLAGS as readonly string[]).includes(flag);
}

export interface FlagChip {
	readonly flag: string;
	readonly known: boolean;
	readonly labelKey: MessageKey;
	readonly explainKey: MessageKey;
}

/** One chip per distinct flag, in the report's order; an unknown flag keeps its key for the label. */
export function flagChips(flags: readonly string[]): FlagChip[] {
	return [...new Set(flags)]
		.filter((flag) => flag.trim() !== "")
		.map((flag) => {
			const words = isKnownFlag(flag) ? BILL_FLAG_KEYS[flag] : OTHER_FLAG_KEYS;
			return { flag, known: isKnownFlag(flag), ...words };
		});
}

/** The flags that appear in the rows, in the catalogue's order and then the unknown ones. */
export function flagsInRows(rows: readonly BillAnomalyRow[]): string[] {
	const seen = new Set(rows.flatMap((row) => row.flags));
	const known = BILL_ANOMALY_FLAGS.filter((flag) => seen.has(flag));
	const other = [...seen]
		.filter((flag) => !isKnownFlag(flag) && flag.trim() !== "")
		.sort();
	return [...known, ...other];
}

/** The share of the bills two agreeing readings confirmed; null without bills. */
export function levelTwoShare(row: BillAnomalyRow): number | null {
	return row.bills > 0 ? row.level2 / row.bills : null;
}

/** Rows with signals first, then the newest day, then the most bills. */
export function sortedBillAnomalies(
	rows: readonly BillAnomalyRow[],
): BillAnomalyRow[] {
	return [...rows].sort((left, right) => {
		const flagged = right.flags.length - left.flags.length;
		if (flagged !== 0) return flagged;
		if (left.businessDate !== right.businessDate) {
			return left.businessDate < right.businessDate ? 1 : -1;
		}
		if (left.bills !== right.bills) return right.bills - left.bills;
		return (left.staffName ?? "").localeCompare(right.staffName ?? "");
	});
}

export interface BillAnomalySummary {
	readonly rows: number;
	readonly flagged: number;
	readonly bills: number;
}

export function billAnomalySummary(
	rows: readonly BillAnomalyRow[],
): BillAnomalySummary {
	return {
		rows: rows.length,
		flagged: rows.filter((row) => row.flags.length > 0).length,
		bills: rows.reduce((total, row) => total + row.bills, 0),
	};
}

/** The chosen stores that confirm at the counter now. */
export function staffModeStoreIds(
	storeIds: readonly string[],
	settings: readonly LoyaltyStoreSettings[],
): string[] {
	const staff = new Set(
		settings
			.filter((row) => row.confirmation === "staff")
			.map((row) => row.storeId),
	);
	return storeIds.filter((id) => staff.has(id));
}
