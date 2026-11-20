// The staff-mode bill functions of migration bill_captures (docs/api.md section 3.26): what the staff app sends and how
// it reads each answer. Every reader is strict: an answer that does not have the documented shape throws instead of
// showing something half-read, an unknown refusal reads as null (shown as the "other" text), and a phone is always shown
// masked. The counter-claim reader never keeps a total, so the customer's reading cannot reach a staff screen.
import {
	answerRows,
	count,
	type IsoInstant,
	instant,
	instantOrNull,
	invalid,
	isRecord,
	known,
	type MemberSummary,
	masked,
	number,
	oneOf,
	type Row,
	readMemberSummary,
	single,
	text,
	textOrNull,
} from "./contract";

export const STAFF_BILL_FUNCTIONS = {
	submit: "staff_submit_bill",
	recent: "staff_recent_bills",
	reverse: "staff_reverse_bill",
	counterCode: "staff_counter_code",
	counterClaims: "staff_counter_claims",
	answerClaim: "staff_answer_counter_claim",
	queue: "staff_bill_queue",
	decide: "staff_decide_bill",
	closeAudit: "staff_close_bill_audit",
	confirmRedemption: "staff_confirm_redemption",
	voidRedemption: "staff_void_redemption",
} as const;

export const MAX_BILL_NO_LENGTH = 40;
export const MAX_BILL_TOTAL = 100_000_000;
export const MAX_BILL_REASON_LENGTH = 200;
export const COUNTER_PAYLOAD =
	/^fnb-counter:1:[^:\s]{1,40}:[A-HJ-NP-Z2-9]{12}$/;

export const STORE_MODES = ["pos_sync", "staff"] as const;
export type StoreMode = (typeof STORE_MODES)[number];

export const BILL_STATES = [
	"awaiting_customer",
	"awaiting_staff",
	"queued",
	"confirmed",
	"reversed",
	"rejected",
	"expired",
] as const;
export type BillState = (typeof BILL_STATES)[number];

export const SUBMIT_STATES = [
	"awaiting_customer",
	"confirmed",
	"queued",
] as const;
export type SubmitState = (typeof SUBMIT_STATES)[number];

export const BILL_REFUSALS = [
	"not_staff_mode",
	"locked",
	"wrong_store",
	"code_unknown",
	"code_expired",
	"code_used",
	"membership_inactive",
	"no_programme",
	"staff_phone",
	"over_bill_limit",
	"bill_conflict",
	"bill_used",
	"daily_limit",
	"staff_shift_cap",
	"staff_amount_cap",
	"store_daily_cap",
	"below_minimum",
] as const;
export type BillRefusal = (typeof BILL_REFUSALS)[number];

export const BILL_SOURCES = ["staff_scan", "counter_claim"] as const;
export type BillSource = (typeof BILL_SOURCES)[number];

export const QUEUE_REASONS = ["over_approval", "disagreement"] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];

export const REVERSAL_REASONS = [
	"disputed",
	"timed_out",
	"manager_rejected",
	"manager_reversed",
	"audit_failed",
] as const;
export type ReversalReason = (typeof REVERSAL_REASONS)[number];

export const SHADOW_STATES = ["matched", "mismatch", "no_invoice"] as const;
export type ShadowState = (typeof SHADOW_STATES)[number];

export const REVERSE_REFUSALS = ["not_reversible", "window_passed"] as const;
export type ReverseRefusal = (typeof REVERSE_REFUSALS)[number];

export const COUNTER_REFUSALS = ["not_available", "no_store_code"] as const;
export type CounterRefusal = (typeof COUNTER_REFUSALS)[number];

export const CLAIM_STATES = [
	"confirmed",
	"queued",
	"rejected",
	"awaiting_staff",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

export const CLAIM_REFUSALS = [
	"already_answered",
	"expired",
	...BILL_REFUSALS,
] as const;
export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];

export const BILL_DECISIONS = ["approved", "rejected"] as const;
export type BillDecision = (typeof BILL_DECISIONS)[number];

export const DECIDE_REFUSALS = ["not_queued", "own_bill"] as const;
export type DecideRefusal = (typeof DECIDE_REFUSALS)[number];

export const AUDIT_RESULTS = ["passed", "failed"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export const AUDIT_REFUSALS = ["closed", "own_bill"] as const;
export type AuditRefusal = (typeof AUDIT_REFUSALS)[number];

export const CONFIRM_REFUSALS = [
	"not_staff_mode",
	"used",
	"released",
	"expired",
	"not_verified",
	"same_staff",
	"staff_daily_cap",
] as const;
export type ConfirmRefusal = (typeof CONFIRM_REFUSALS)[number];

export const VOID_REFUSALS = [
	"already_voided",
	"not_staff_confirmed",
	"window_passed",
] as const;
export type VoidRefusal = (typeof VOID_REFUSALS)[number];

export interface BillInput {
	readonly storeId: string;
	/** six digits, or the scanned fnb-member:1:<store code>:<code> payload */
	readonly code: string;
	readonly billNo: string;
	readonly total: number;
}

export type SubmitAnswer =
	| {
			readonly outcome: "recorded";
			readonly billId: string;
			readonly state: SubmitState;
			readonly evidenceLevel: number;
			readonly stampsEarned: number;
			readonly pointsEarned: number;
			readonly recordedAt: IsoInstant;
			readonly confirmBy: IsoInstant | null;
			readonly reverseUntil: IsoInstant | null;
			readonly member: MemberSummary;
	  }
	| {
			readonly outcome: "refused";
			readonly refusal: BillRefusal | null;
			readonly retryAt: IsoInstant | null;
	  };

export interface RecentBill {
	readonly id: string;
	readonly createdAt: IsoInstant;
	readonly billNo: string;
	readonly total: number;
	readonly source: BillSource;
	readonly state: BillState;
	readonly queueReason: QueueReason | null;
	readonly reversalReason: ReversalReason | null;
	readonly evidenceLevel: number;
	readonly byMe: boolean;
	readonly recordedByName: string | null;
	readonly phoneMasked: string;
	readonly stamps: number;
	readonly points: number;
	readonly reverseUntil: IsoInstant | null;
	readonly reversible: boolean;
	readonly shadowState: ShadowState | null;
}

export interface StoreBillMode {
	readonly mode: StoreMode;
	readonly selfClaim: boolean;
	readonly isManager: boolean;
}

export interface RecentBills extends StoreBillMode {
	readonly bills: readonly RecentBill[];
}

export type ReverseAnswer =
	| { readonly state: "reversed" }
	| { readonly state: "refused"; readonly refusal: ReverseRefusal | null };

export type CounterCode =
	| {
			readonly state: "ready";
			readonly qrPayload: string;
			readonly expiresAt: IsoInstant;
			readonly refreshAt: IsoInstant;
	  }
	| { readonly state: "refused"; readonly refusal: CounterRefusal | null };

export interface CounterClaim {
	readonly id: string;
	readonly createdAt: IsoInstant;
	readonly expiresAt: IsoInstant;
	readonly billNo: string;
	readonly phoneMasked: string;
	readonly displayName: string | null;
}

export type ClaimReply =
	| { readonly billId: string; readonly total: number }
	| { readonly billId: string; readonly rejectReason: string };

export type ClaimAnswer =
	| {
			readonly state: ClaimState;
			readonly evidenceLevel: number | null;
			readonly stampsEarned: number;
			readonly pointsEarned: number;
	  }
	| { readonly state: "refused"; readonly refusal: ClaimRefusal | null };

export interface QueuedBill {
	readonly id: string;
	readonly createdAt: IsoInstant;
	readonly billNo: string;
	readonly source: BillSource;
	readonly queueReason: QueueReason;
	readonly evidenceLevel: number;
	readonly staffTotal: number | null;
	readonly customerTotal: number | null;
	readonly recordedByName: string | null;
	readonly own: boolean;
	readonly phoneMasked: string;
}

export interface BillAudit {
	readonly id: string;
	readonly billId: string;
	readonly openedAt: IsoInstant;
	readonly billNo: string;
	readonly total: number;
	readonly evidenceLevel: number;
	readonly hasPhoto: boolean;
	readonly recordedByName: string | null;
	readonly phoneMasked: string;
}

export interface BillQueue {
	readonly bills: readonly QueuedBill[];
	readonly audits: readonly BillAudit[];
}

export type DecideAnswer =
	| { readonly state: BillDecision; readonly billState: BillState | null }
	| { readonly state: "refused"; readonly refusal: DecideRefusal | null };

export type AuditAnswer =
	| { readonly state: AuditResult }
	| { readonly state: "refused"; readonly refusal: AuditRefusal | null };

export type ConfirmRedemptionAnswer =
	| {
			readonly state: "confirmed";
			readonly voidUntil: IsoInstant | null;
			readonly posDiscountName: string | null;
	  }
	| { readonly state: "refused"; readonly refusal: ConfirmRefusal | null };

export type VoidRedemptionAnswer =
	| { readonly state: "voided" }
	| { readonly state: "refused"; readonly refusal: VoidRefusal | null };

export interface BillsClient {
	submit(input: BillInput): Promise<SubmitAnswer>;
	recent(storeId: string): Promise<RecentBills>;
	/** the store's mode, self claims and the caller's manager flag (staff_recent_bills without the list) */
	mode(storeId: string): Promise<StoreBillMode>;
	reverse(billId: string, reason: string): Promise<ReverseAnswer>;
	counterCode(storeId: string): Promise<CounterCode>;
	counterClaims(storeId: string): Promise<CounterClaim[]>;
	answerClaim(reply: ClaimReply): Promise<ClaimAnswer>;
	queue(storeId: string): Promise<BillQueue>;
	decide(
		billId: string,
		decision: BillDecision,
		reason: string,
	): Promise<DecideAnswer>;
	closeAudit(
		auditId: string,
		result: AuditResult,
		note: string | null,
	): Promise<AuditAnswer>;
	confirmRedemption(redemptionId: string): Promise<ConfirmRedemptionAnswer>;
	voidRedemption(
		redemptionId: string,
		reason: string,
	): Promise<VoidRedemptionAnswer>;
}

// --- what is sent ------------------------------------------------------------------------------

export function submitArgs(input: BillInput): Row {
	return {
		p_store_id: input.storeId,
		p_code: input.code,
		p_bill_no: input.billNo,
		p_total: input.total,
	};
}

export function storeArgs(storeId: string): Row {
	return { p_store_id: storeId };
}

export function reverseArgs(billId: string, reason: string): Row {
	return { p_bill_id: billId, p_reason: reason };
}

/** exactly one of the total and the rejection reason, the other null, as the database requires */
export function answerClaimArgs(reply: ClaimReply): Row {
	return "total" in reply
		? { p_bill_id: reply.billId, p_total: reply.total, p_reject_reason: null }
		: {
				p_bill_id: reply.billId,
				p_total: null,
				p_reject_reason: reply.rejectReason,
			};
}

export function decideArgs(
	billId: string,
	decision: BillDecision,
	reason: string,
): Row {
	return { p_bill_id: billId, p_decision: decision, p_reason: reason };
}

export function closeAuditArgs(
	auditId: string,
	result: AuditResult,
	note: string | null,
): Row {
	return { p_audit_id: auditId, p_result: result, p_note: note };
}

export function redemptionArgs(redemptionId: string): Row {
	return { p_redemption_id: redemptionId };
}

export function voidArgs(redemptionId: string, reason: string): Row {
	return { p_redemption_id: redemptionId, p_reason: reason };
}

// --- how answers are read ----------------------------------------------------------------------

function flag(value: unknown, what: string): boolean {
	return typeof value === "boolean" ? value : invalid(what);
}

function flagOr(value: unknown, fallback: boolean, what: string): boolean {
	return value === null || value === undefined ? fallback : flag(value, what);
}

function level(value: unknown, what: string): number {
	const parsed = count(value, what);
	return parsed <= 3 ? parsed : invalid(what);
}

function levelOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : level(value, what);
}

function amount(value: unknown, what: string): number {
	const parsed = number(value, what);
	return parsed > 0 && parsed <= MAX_BILL_TOTAL ? parsed : invalid(what);
}

function amountOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : amount(value, what);
}

function earned(value: unknown, what: string): number {
	return value === null || value === undefined ? 0 : count(value, what);
}

function knownOrNull<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T | null {
	return value === null || value === undefined
		? null
		: oneOf(allowed, value, what);
}

function isRefused(row: Row): boolean {
	return row.state === "refused";
}

function object(value: unknown, what: string): Row {
	if (Array.isArray(value) && value.length === 1) return object(value[0], what);
	return isRecord(value) ? value : invalid(what);
}

export function readSubmitAnswer(value: unknown): SubmitAnswer {
	const row = object(value, "bill");
	if (isRefused(row)) {
		return {
			outcome: "refused",
			refusal: known(BILL_REFUSALS, row.refusal),
			retryAt: instantOrNull(row.retry_at, "retry time"),
		};
	}
	if (!isRecord(row.member)) invalid("bill member");
	return {
		outcome: "recorded",
		billId: text(row.bill_id, "bill id"),
		state: oneOf(SUBMIT_STATES, row.state, "bill state"),
		evidenceLevel: level(row.evidence_level, "evidence level"),
		stampsEarned: earned(row.stamps_earned, "stamps earned"),
		pointsEarned: earned(row.points_earned, "points earned"),
		recordedAt: instant(row.recorded_at, "bill time"),
		confirmBy: instantOrNull(row.confirm_by, "customer deadline"),
		reverseUntil: instantOrNull(row.reverse_until, "reverse window"),
		member: readMemberSummary(row),
	};
}

export function readRecentBill(value: unknown): RecentBill {
	const row = single(value, "recent bill");
	return {
		id: text(row.id, "bill id"),
		createdAt: instant(row.created_at, "bill time"),
		billNo: text(row.bill_no, "bill number"),
		total: amount(row.total, "bill total"),
		source: oneOf(BILL_SOURCES, row.source, "bill source"),
		state: oneOf(BILL_STATES, row.state, "bill state"),
		queueReason: knownOrNull(QUEUE_REASONS, row.queue_reason, "queue reason"),
		reversalReason: knownOrNull(
			REVERSAL_REASONS,
			row.reversal_reason,
			"reversal reason",
		),
		evidenceLevel: level(row.evidence_level, "evidence level"),
		byMe: flagOr(row.by_me, false, "own bill"),
		recordedByName: textOrNull(row.recorded_by_name, "recorder"),
		phoneMasked: masked(row.phone_masked, "member phone"),
		stamps: earned(row.stamps, "bill stamps"),
		points: earned(row.points, "bill points"),
		reverseUntil: instantOrNull(row.reverse_until, "reverse window"),
		reversible: flagOr(row.reversible, false, "reversible"),
		shadowState: knownOrNull(SHADOW_STATES, row.shadow_state, "shadow state"),
	};
}

function readMode(row: Row): StoreBillMode {
	return {
		mode: oneOf(STORE_MODES, row.mode ?? "pos_sync", "store mode"),
		selfClaim: flagOr(row.self_claim, false, "self claim"),
		isManager: flagOr(row.is_manager, false, "manager flag"),
	};
}

export function readRecentBills(value: unknown): RecentBills {
	const row = object(value, "recent bills");
	return {
		...readMode(row),
		bills: answerRows(row.bills ?? [], "recent bills").map(readRecentBill),
	};
}

export function readStoreBillMode(value: unknown): StoreBillMode {
	return readMode(object(value, "recent bills"));
}

export function readReverseAnswer(value: unknown): ReverseAnswer {
	const row = object(value, "reversal");
	if (isRefused(row))
		return { state: "refused", refusal: known(REVERSE_REFUSALS, row.refusal) };
	oneOf(["reversed"] as const, row.state, "reversal state");
	return { state: "reversed" };
}

export function readCounterCode(value: unknown): CounterCode {
	const row = object(value, "counter code");
	if (isRefused(row))
		return { state: "refused", refusal: known(COUNTER_REFUSALS, row.refusal) };
	oneOf(["ready"] as const, row.state, "counter code state");
	const payload = text(row.qr_payload, "counter QR");
	if (!COUNTER_PAYLOAD.test(payload)) invalid("counter QR");
	const expiresAt = instant(row.expires_at, "counter QR expiry");
	const refreshAt = instant(row.refresh_at, "counter QR refresh");
	if (Date.parse(refreshAt) > Date.parse(expiresAt))
		invalid("counter QR refresh");
	return { state: "ready", qrPayload: payload, expiresAt, refreshAt };
}

/** never reads a total: the staff member types the total from the bill without seeing the customer's */
export function readCounterClaim(value: unknown): CounterClaim {
	const row = single(value, "counter claim");
	return {
		id: text(row.id, "claim id"),
		createdAt: instant(row.created_at, "claim time"),
		expiresAt: instant(row.expires_at, "claim expiry"),
		billNo: text(row.bill_no, "claim bill number"),
		phoneMasked: masked(row.phone_masked, "member phone"),
		displayName: textOrNull(row.display_name, "member name"),
	};
}

export function readCounterClaims(value: unknown): CounterClaim[] {
	return answerRows(value ?? [], "counter claims").map(readCounterClaim);
}

export function readClaimAnswer(value: unknown): ClaimAnswer {
	const row = object(value, "claim answer");
	if (isRefused(row))
		return { state: "refused", refusal: known(CLAIM_REFUSALS, row.refusal) };
	return {
		state: oneOf(CLAIM_STATES, row.state, "claim state"),
		evidenceLevel: levelOrNull(row.evidence_level, "evidence level"),
		stampsEarned: earned(row.stamps_earned, "stamps earned"),
		pointsEarned: earned(row.points_earned, "points earned"),
	};
}

export function readQueuedBill(value: unknown): QueuedBill {
	const row = single(value, "queued bill");
	return {
		id: text(row.id, "bill id"),
		createdAt: instant(row.created_at, "bill time"),
		billNo: text(row.bill_no, "bill number"),
		source: oneOf(BILL_SOURCES, row.source, "bill source"),
		queueReason: oneOf(QUEUE_REASONS, row.queue_reason, "queue reason"),
		evidenceLevel: level(row.evidence_level, "evidence level"),
		staffTotal: amountOrNull(row.staff_total, "staff total"),
		customerTotal: amountOrNull(row.customer_total, "customer total"),
		recordedByName: textOrNull(row.recorded_by_name, "recorder"),
		own: flagOr(row.own, false, "own bill"),
		phoneMasked: masked(row.phone_masked, "member phone"),
	};
}

export function readBillAudit(value: unknown): BillAudit {
	const row = single(value, "bill audit");
	return {
		id: text(row.id, "audit id"),
		billId: text(row.bill_id, "audit bill"),
		openedAt: instant(row.opened_at, "audit time"),
		billNo: text(row.bill_no, "bill number"),
		total: amount(row.total, "bill total"),
		evidenceLevel: level(row.evidence_level, "evidence level"),
		hasPhoto: flagOr(row.has_photo, false, "photo flag"),
		recordedByName: textOrNull(row.recorded_by_name, "recorder"),
		phoneMasked: masked(row.phone_masked, "member phone"),
	};
}

export function readBillQueue(value: unknown): BillQueue {
	const row = object(value, "bill queue");
	return {
		bills: answerRows(row.bills ?? [], "queued bills").map(readQueuedBill),
		audits: answerRows(row.audits ?? [], "bill audits").map(readBillAudit),
	};
}

export function readDecideAnswer(value: unknown): DecideAnswer {
	const row = object(value, "bill decision");
	if (isRefused(row))
		return { state: "refused", refusal: known(DECIDE_REFUSALS, row.refusal) };
	return {
		state: oneOf(BILL_DECISIONS, row.state, "bill decision"),
		billState: knownOrNull(BILL_STATES, row.bill_state, "bill state"),
	};
}

export function readAuditAnswer(value: unknown): AuditAnswer {
	const row = object(value, "audit answer");
	if (isRefused(row))
		return { state: "refused", refusal: known(AUDIT_REFUSALS, row.refusal) };
	return { state: oneOf(AUDIT_RESULTS, row.state, "audit result") };
}

export function readConfirmRedemption(value: unknown): ConfirmRedemptionAnswer {
	const row = object(value, "redemption confirmation");
	if (isRefused(row))
		return { state: "refused", refusal: known(CONFIRM_REFUSALS, row.refusal) };
	oneOf(["confirmed"] as const, row.state, "confirmation state");
	return {
		state: "confirmed",
		voidUntil: instantOrNull(row.void_until, "void window"),
		posDiscountName: textOrNull(row.pos_discount_name, "POS discount name"),
	};
}

export function readVoidRedemption(value: unknown): VoidRedemptionAnswer {
	const row = object(value, "redemption void");
	if (isRefused(row))
		return { state: "refused", refusal: known(VOID_REFUSALS, row.refusal) };
	oneOf(["voided"] as const, row.state, "void state");
	return { state: "voided" };
}
