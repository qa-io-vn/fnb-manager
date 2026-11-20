import {
	type BillInput,
	type BillState,
	MAX_BILL_NO_LENGTH,
	MAX_BILL_TOTAL,
	type RecentBill,
} from "./bills-contract";
import { MEMBER_CODE_LENGTH } from "./contract";
import { readScannedMember } from "./model";

export const BILL_TOTAL_MAX_CHARS = 15;
export const MIN_COUNTER_REFRESH_MS = 5_000;
export const MAX_COUNTER_REFRESH_MS = 10 * 60_000;
export const CLAIMS_POLL_MS = 15_000;

const BILL_NO = /^[^\s\p{Cc}]+$/u;
const GROUPED_TOTAL = /^\d{1,3}(?:[.,\s]\d{3})+$/;
const PLAIN_TOTAL = /^\d+$/;

export type FieldProblem = "empty" | "format" | "zero" | "large";

export type BillField = "code" | "billNo" | "total";

export interface BillProblem {
	readonly field: BillField;
	readonly problem: FieldProblem;
}

export interface BillDraft {
	readonly code: string;
	/** the scanned payload, sent instead of the six digits so the server checks the store */
	readonly payload: string | null;
	readonly billNo: string;
	readonly total: string;
}

export const EMPTY_DRAFT: BillDraft = {
	code: "",
	payload: null,
	billNo: "",
	total: "",
};

export function codeDigits(text: string): string {
	return text.replace(/\D/g, "").slice(0, MEMBER_CODE_LENGTH);
}

export function readBillNo(
	text: string,
): { ok: true; billNo: string } | { ok: false; problem: FieldProblem } {
	const value = text.trim();
	if (value === "") return { ok: false, problem: "empty" };
	if (value.length > MAX_BILL_NO_LENGTH || !BILL_NO.test(value))
		return { ok: false, problem: "format" };
	return { ok: true, billNo: value };
}

/** a đồng total as printed on a bill: 185000, 185.000, 185,000 or 185 000; no decimals */
export function readBillTotal(
	text: string,
): { ok: true; total: number } | { ok: false; problem: FieldProblem } {
	const value = text.trim().replace(/\s*(?:₫|đ|vnd|vnđ)$/i, "");
	if (value === "") return { ok: false, problem: "empty" };
	if (!PLAIN_TOTAL.test(value) && !GROUPED_TOTAL.test(value))
		return { ok: false, problem: "format" };
	const total = Number(value.replace(/[.,\s]/g, ""));
	if (!Number.isSafeInteger(total)) return { ok: false, problem: "large" };
	if (total <= 0) return { ok: false, problem: "zero" };
	if (total > MAX_BILL_TOTAL) return { ok: false, problem: "large" };
	return { ok: true, total };
}

export function readMemberCode(
	draft: Pick<BillDraft, "code" | "payload">,
): { ok: true; code: string } | { ok: false; problem: FieldProblem } {
	if (draft.payload !== null) {
		const scanned = readScannedMember(draft.payload);
		if (scanned.ok) return { ok: true, code: scanned.payload ?? scanned.code };
	}
	const value = draft.code.trim();
	if (value === "") return { ok: false, problem: "empty" };
	const read = readScannedMember(value);
	return read.ok
		? { ok: true, code: read.code }
		: { ok: false, problem: "format" };
}

export type BillCheck =
	| { readonly ok: true; readonly input: BillInput }
	| { readonly ok: false; readonly problems: readonly BillProblem[] };

export function billInput(storeId: string, draft: BillDraft): BillCheck {
	const code = readMemberCode(draft);
	const billNo = readBillNo(draft.billNo);
	const total = readBillTotal(draft.total);
	const problems: BillProblem[] = [];
	if (!code.ok) problems.push({ field: "code", problem: code.problem });
	if (!billNo.ok) problems.push({ field: "billNo", problem: billNo.problem });
	if (!total.ok) problems.push({ field: "total", problem: total.problem });
	if (!code.ok || !billNo.ok || !total.ok) return { ok: false, problems };
	return {
		ok: true,
		input: {
			storeId,
			code: code.code,
			billNo: billNo.billNo,
			total: total.total,
		},
	};
}

export type StateTone = "positive" | "warning" | "negative" | "neutral";

export const BILL_STATE_TONES: Readonly<Record<BillState, StateTone>> = {
	awaiting_customer: "warning",
	awaiting_staff: "warning",
	queued: "neutral",
	confirmed: "positive",
	reversed: "negative",
	rejected: "negative",
	expired: "negative",
};

/** reversible by the server's word and still inside its window at this moment */
export function canReverse(bill: RecentBill, now: Date): boolean {
	if (!bill.reversible) return false;
	return (
		bill.reverseUntil === null || now.getTime() <= Date.parse(bill.reverseUntil)
	);
}

/** when to ask for the counter QR again: at its refresh time, never sooner than 5 s or later than 10 min */
export function refreshDelay(refreshAt: string, now: Date): number {
	const wanted = Date.parse(refreshAt) - now.getTime();
	if (!Number.isFinite(wanted)) return MIN_COUNTER_REFRESH_MS;
	return Math.min(
		MAX_COUNTER_REFRESH_MS,
		Math.max(MIN_COUNTER_REFRESH_MS, wanted),
	);
}

export function withinWindow(until: string | null, now: Date): boolean {
	return until !== null && now.getTime() <= Date.parse(until);
}
