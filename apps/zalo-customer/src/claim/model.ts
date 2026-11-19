import {
	type ClaimInput,
	ISO_DATE_PATTERN,
	type IsoDate,
	knownClaimReason,
	MAX_CLAIM_AMOUNT,
	RECEIPT_NO_MAX_LENGTH,
	RECEIPT_NO_PATTERN,
	type ReceiptNumbersReset,
} from "@fnb/zalo-mini/loyalty";

export interface ClaimDraft {
	readonly store: string | null;
	readonly receiptNo: string;
	readonly amount: string;
	readonly businessDate: IsoDate;
}

export type ClaimField = "store" | "receiptNo" | "amount" | "businessDate";

export type ClaimProblems = Partial<Record<ClaimField, string>>;

export function cleanReceiptNo(value: string): string {
	return [...value.replace(/[\s\p{Cc}]+/gu, "")]
		.slice(0, RECEIPT_NO_MAX_LENGTH)
		.join("");
}

export function cleanAmount(value: string): string {
	return value
		.replace(/\D/g, "")
		.replace(/^0+(?=\d)/, "")
		.slice(0, 9);
}

export function groupedAmount(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function claimProblems(
	draft: ClaimDraft,
	dates: readonly IsoDate[],
): ClaimProblems {
	const problems: Record<string, string> = {};
	if (draft.store === null) problems.store = "claim.problem.store";
	if (draft.receiptNo === "")
		problems.receiptNo = "claim.problem.receiptMissing";
	else if (!RECEIPT_NO_PATTERN.test(draft.receiptNo))
		problems.receiptNo = "claim.problem.receiptInvalid";
	const amount = Number(draft.amount);
	if (draft.amount === "") problems.amount = "claim.problem.amountMissing";
	else if (
		!Number.isInteger(amount) ||
		amount <= 0 ||
		amount > MAX_CLAIM_AMOUNT
	)
		problems.amount = "claim.problem.amountInvalid";
	if (!dates.includes(draft.businessDate))
		problems.businessDate = "claim.problem.date";
	return problems;
}

export function claimInput(
	draft: ClaimDraft,
	dates: readonly IsoDate[],
): ClaimInput | null {
	if (
		Object.keys(claimProblems(draft, dates)).length > 0 ||
		draft.store === null
	)
		return null;
	return {
		store: draft.store,
		receiptNo: draft.receiptNo,
		amount: Number(draft.amount),
		businessDate: draft.businessDate,
	};
}

/** A daily-numbering POS (iPOS tran_no) prints the 2-digit day of month, then a 4-digit daily sequence. */
export const DAILY_RECEIPT_DIGITS = 6;

/**
 * The day of month a receipt number of a store that restarts its numbering
 * each day should start with, when the number typed does not: a gentle
 * warning, never a refusal. A shorter number of digits is read with its
 * leading zeros restored; a number with other characters is not checked.
 */
export function receiptDayMismatch(
	receiptNo: string,
	businessDate: IsoDate,
	reset: ReceiptNumbersReset | null,
): string | null {
	if (
		reset !== "daily" ||
		!/^\d+$/.test(receiptNo) ||
		!ISO_DATE_PATTERN.test(businessDate)
	)
		return null;
	const day = businessDate.slice(8, 10);
	const digits = receiptNo.padStart(DAILY_RECEIPT_DIGITS, "0");
	return digits.slice(0, 2) === day ? null : day;
}

export function claimReasonKey(reason: string): string {
	const known = knownClaimReason(reason);
	return known === null ? "claim.reason.other" : `claim.reason.${known}`;
}
