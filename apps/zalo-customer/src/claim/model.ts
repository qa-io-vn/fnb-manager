import {
	type ClaimInput,
	type IsoDate,
	knownClaimReason,
	MAX_CLAIM_AMOUNT,
	RECEIPT_NO_MAX_LENGTH,
	RECEIPT_NO_PATTERN,
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

export function claimReasonKey(reason: string): string {
	const known = knownClaimReason(reason);
	return known === null ? "claim.reason.other" : `claim.reason.${known}`;
}
