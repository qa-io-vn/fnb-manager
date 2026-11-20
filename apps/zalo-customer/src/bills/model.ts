import {
	type BillConfirmResult,
	type BillDisputeResult,
	type CounterClaimResult,
	type CounterQr,
	knownBillRefusal,
	knownCounterClaimRefusal,
	MAX_CLAIM_AMOUNT,
	RECEIPT_NO_PATTERN,
	readCounterQr,
} from "@fnb/zalo-mini/loyalty";

export type Tone = "positive" | "pending" | "neutral" | "negative";

export interface BillOutcome {
	readonly key: string;
	readonly tone: Tone;
}

/**
 * The words for the answer to a blind total or a dispute. A disagreement says only that the totals differ, never
 * whether the store's total was higher or lower, so the one answer a bill allows gives nothing more away.
 */
export function billOutcome(
	result: BillConfirmResult | BillDisputeResult,
): BillOutcome {
	switch (result.state) {
		case "confirmed":
			return { key: "bill.result.confirmed", tone: "positive" };
		case "queued":
			return { key: "bill.result.queued", tone: "pending" };
		case "awaiting_customer":
			return { key: "bill.result.waiting", tone: "pending" };
		case "reversed":
			return { key: "bill.result.reversed", tone: "neutral" };
		default:
			return {
				key: `bill.refusal.${knownBillRefusal(result.refusal) ?? "other"}`,
				tone: "negative",
			};
	}
}

/** The total typed as digits, or null when it is not a whole number of đồng from 1 to 100,000,000. */
export function typedTotal(digits: string): number | null {
	if (!/^\d+$/.test(digits)) return null;
	const total = Number(digits);
	return Number.isSafeInteger(total) && total > 0 && total <= MAX_CLAIM_AMOUNT
		? total
		: null;
}

export function totalProblem(digits: string): string | null {
	if (digits === "") return "bill.problem.totalMissing";
	return typedTotal(digits) === null ? "bill.problem.totalInvalid" : null;
}

export function billNoProblem(billNo: string): string | null {
	if (billNo === "") return "claim.problem.receiptMissing";
	return RECEIPT_NO_PATTERN.test(billNo)
		? null
		: "claim.problem.receiptInvalid";
}

export type ScanReading =
	| { readonly kind: "counter"; readonly qr: CounterQr }
	| { readonly kind: "not-counter" };

/** What a scanned text is: a counter QR, or anything else (a member code, a voucher, a link), which is not sent. */
export function readScan(content: string): ScanReading {
	const qr = readCounterQr(content);
	return qr === null ? { kind: "not-counter" } : { kind: "counter", qr };
}

export function counterRefusalKey(refusal: string | null): string {
	return `counter.refusal.${knownCounterClaimRefusal(refusal) ?? "other"}`;
}

/** Refusals after which the customer scans a new code rather than fixing the bill. */
const RESCAN_REFUSALS: ReadonlySet<string> = new Set([
	"code_unknown",
	"wrong_store",
	"code_expired",
	"code_used",
]);

export function rescanAfter(result: CounterClaimResult): boolean {
	return result.refusal !== null && RESCAN_REFUSALS.has(result.refusal);
}
