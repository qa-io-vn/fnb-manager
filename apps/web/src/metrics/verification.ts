import type { VerificationMarker } from "../components/report-card/types";
import type { VerificationRows } from "../data/row-source";
import type { IsoDate } from "../lib/business-dates";

export interface StoreDay {
	storeId: string;
	date: IsoDate;
}

export function verificationOf(
	rows: VerificationRows,
	storeDays: readonly StoreDay[],
): VerificationMarker {
	if (rows.kind === "sample") return "sample";
	if (storeDays.length === 0) return "unverified";
	const matched = new Set(
		rows.checks
			.filter((check) => check.isMatched)
			.map((check) => `${check.storeId}|${check.businessDate}`),
	);
	return storeDays.every((storeDay) =>
		matched.has(`${storeDay.storeId}|${storeDay.date}`),
	)
		? "verified"
		: "unverified";
}
