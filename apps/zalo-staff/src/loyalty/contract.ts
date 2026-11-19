export const STAFF_LOYALTY_FUNCTIONS = {
	recordCheckin: "staff_record_checkin",
	verifyRedemption: "staff_verify_redemption",
	memberLookup: "staff_member_lookup",
	request: "staff_request",
	queue: "staff_loyalty_queue",
	decide: "staff_decide_loyalty_request",
	myRequests: "staff_my_loyalty_requests",
	resolveMatch: "resolve_loyalty_queue_item",
} as const;

export type StaffLoyaltyFunction =
	(typeof STAFF_LOYALTY_FUNCTIONS)[keyof typeof STAFF_LOYALTY_FUNCTIONS];

export const MEMBER_CODE_LENGTH = 6;
export const MAX_REDEMPTION_CODE_LENGTH = 64;
export const MAX_REASON_LENGTH = 200;
export const MAX_ADJUSTMENT = 1000;

export const CHECKIN_STATES = ["pending", "matched", "queued"] as const;
export type CheckinState = (typeof CHECKIN_STATES)[number];

export const CHECKIN_REFUSALS = [
	"code_unknown",
	"code_expired",
	"code_used",
	"wrong_store",
	"not_member",
	"staff_phone",
	"daily_limit",
	"membership_inactive",
	"invalid_phone",
] as const;
export type CheckinRefusal = (typeof CHECKIN_REFUSALS)[number];

export const REDEMPTION_RAILS = [
	"pos_payment_discount",
	"crm_code_pool",
	"crm_callback",
] as const;
export type RedemptionRail = (typeof REDEMPTION_RAILS)[number];

export const REDEMPTION_REFUSALS = [
	"used",
	"expired",
	"unknown",
	"wrong_store",
	"released",
] as const;
export type RedemptionRefusal = (typeof REDEMPTION_REFUSALS)[number];

export const MEMBERSHIP_STATUSES = ["active", "suspended", "closed"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const VISIT_STATES = [
	"pending",
	"confirmed",
	"queued",
	"rejected",
] as const;
export type VisitState = (typeof VISIT_STATES)[number];

export const VISIT_PATHS = [
	"phone",
	"member_code",
	"receipt_claim",
	"voucher",
	"manual",
] as const;
export type VisitPath = (typeof VISIT_PATHS)[number];

const LEDGER_PATHS: Readonly<Record<string, VisitPath>> = {
	A: "phone",
	B: "member_code",
	C: "receipt_claim",
	D: "voucher",
};

export const REQUEST_KINDS = ["dispute", "adjustment"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const REQUEST_STATES = [
	"pending",
	"applied",
	"approved",
	"refused",
] as const;
export type RequestState = (typeof REQUEST_STATES)[number];

export const QUEUE_KINDS = ["match", "dispute", "adjustment"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

export const DECISIONS = ["approved", "refused"] as const;
export type Decision = (typeof DECISIONS)[number];

export const QUEUE_OUTCOMES = [
	"resolved",
	"dismissed",
	"approved",
	"refused",
] as const;
export type QueueOutcomeState = (typeof QUEUE_OUTCOMES)[number];

export type IsoInstant = string;
export type IsoDate = string;

export type CheckinEntry =
	| { readonly kind: "phone"; readonly phone: string }
	| {
			readonly kind: "code";
			readonly code: string;
			readonly payload: string | null;
	  };

export interface CheckinInput {
	readonly storeId: string;
	readonly entry: CheckinEntry;
}

export interface MemberSummary {
	readonly membershipId: string | null;
	readonly phoneMasked: string;
	readonly displayName: string | null;
	readonly stamps: number | null;
	readonly stampsPerCard: number | null;
	readonly points: number | null;
}

export type CheckinAnswer =
	| {
			readonly outcome: "recorded";
			readonly checkinId: string;
			readonly state: CheckinState;
			readonly recordedAt: IsoInstant;
			readonly confirmBy: IsoInstant | null;
			readonly member: MemberSummary;
	  }
	| {
			readonly outcome: "refused";
			readonly refusal: CheckinRefusal | null;
			readonly textKey: string | null;
	  };

export type RedemptionInstruction =
	| { readonly kind: "pos_discount"; readonly discountName: string }
	| { readonly kind: "voucher_code"; readonly voucherCode: string };

export type RedemptionAnswer =
	| {
			readonly outcome: "accepted";
			readonly redemptionId: string;
			readonly rewardName: string;
			readonly rail: RedemptionRail;
			readonly instruction: RedemptionInstruction;
			readonly minBillAmount: number | null;
			readonly holdUntil: IsoInstant | null;
			readonly confirmBy: IsoInstant | null;
			readonly phoneMasked: string | null;
	  }
	| {
			readonly outcome: "refused";
			readonly refusal: RedemptionRefusal | null;
			readonly textKey: string | null;
			readonly usedAt: IsoInstant | null;
			readonly usedStoreName: string | null;
			readonly expiredAt: IsoInstant | null;
	  };

export type LookupQuery =
	| { readonly kind: "phone"; readonly phone: string }
	| { readonly kind: "membership"; readonly membershipId: string };

export interface MemberCard {
	readonly membershipId: string;
	readonly phoneMasked: string;
	readonly displayName: string | null;
	readonly memberSince: IsoDate | null;
	readonly status: MembershipStatus;
	readonly tierName: string | null;
	readonly stamps: number;
	readonly stampsPerCard: number;
	readonly stampsPending: number;
	readonly points: number;
	readonly pointsPending: number;
}

export interface Visit {
	readonly at: IsoInstant;
	readonly state: VisitState;
	readonly path: VisitPath;
	readonly stamps: number;
	readonly points: number;
	readonly receiptNo: string | null;
}

export interface AdjustLimits {
	readonly stamps: number;
	readonly points: number;
}

export type LookupAnswer =
	| { readonly found: false }
	| {
			readonly found: true;
			readonly card: MemberCard;
			readonly storeName: string | null;
			readonly today: readonly Visit[];
			readonly limits: AdjustLimits | null;
	  };

export interface RequestInput {
	readonly kind: RequestKind;
	readonly storeId: string;
	readonly membershipId: string;
	readonly reason: string;
	readonly stamps: number;
	readonly points: number;
}

export interface RequestReceipt {
	readonly requestId: string;
	readonly kind: RequestKind;
	readonly state: RequestState;
}

export interface MatchCandidate {
	readonly invoiceId: string;
	readonly receiptNo: string | null;
	readonly soldAt: IsoInstant;
	readonly amount: number;
}

export interface MatchDetails {
	readonly path: "member_code" | "receipt_claim";
	readonly recordedAt: IsoInstant | null;
	readonly amount: number | null;
	readonly receiptNo: string | null;
	readonly candidates: readonly MatchCandidate[];
}

export interface QueueItem {
	readonly id: string;
	readonly kind: QueueKind;
	readonly storeId: string;
	readonly createdAt: IsoInstant;
	readonly phoneMasked: string;
	readonly requestedBy: string | null;
	readonly reason: string | null;
	readonly stamps: number;
	readonly points: number;
	readonly match: MatchDetails | null;
}

export type QueueAction =
	| {
			readonly kind: "match";
			readonly itemId: string;
			readonly invoiceId: string | null;
			readonly reason: string;
	  }
	| {
			readonly kind: "decide";
			readonly itemId: string;
			readonly decision: Decision;
			readonly reason: string;
			readonly stamps: number;
			readonly points: number;
	  };

export interface QueueOutcome {
	readonly state: QueueOutcomeState;
	readonly refusal: string | null;
}

export interface MyRequest {
	readonly id: string;
	readonly kind: RequestKind;
	readonly createdAt: IsoInstant;
	readonly phoneMasked: string;
	readonly reason: string;
	readonly stamps: number;
	readonly points: number;
	readonly state: RequestState;
	readonly decidedAt: IsoInstant | null;
	readonly decisionReason: string | null;
	readonly storeName: string | null;
}

export interface LoyaltyClient {
	recordCheckin(input: CheckinInput): Promise<CheckinAnswer>;
	verifyRedemption(storeId: string, code: string): Promise<RedemptionAnswer>;
	lookupMember(storeId: string, query: LookupQuery): Promise<LookupAnswer>;
	request(input: RequestInput): Promise<RequestReceipt>;
	queue(storeId: string): Promise<QueueItem[]>;
	act(action: QueueAction): Promise<QueueOutcome>;
	myRequests(): Promise<MyRequest[]>;
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the loyalty answer has no valid ${what}`);
}

function single(value: unknown, what: string): Row {
	if (Array.isArray(value) && value.length === 1) return single(value[0], what);
	return isRecord(value) ? value : invalid(what);
}

export function answerRows(value: unknown, what: string): readonly unknown[] {
	return Array.isArray(value) ? value : invalid(what);
}

function text(value: unknown, what: string): string {
	return typeof value === "string" && value.trim() !== ""
		? value
		: invalid(what);
}

function textOrNull(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" ? value.trim() || null : invalid(what);
}

function number(value: unknown, what: string): number {
	const parsed =
		typeof value === "string" && value.trim() !== "" ? Number(value) : value;
	return typeof parsed === "number" && Number.isFinite(parsed)
		? parsed
		: invalid(what);
}

function numberOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : number(value, what);
}

function whole(value: unknown, what: string): number {
	const parsed = number(value, what);
	return Number.isInteger(parsed) ? parsed : invalid(what);
}

function count(value: unknown, what: string): number {
	const parsed = whole(value, what);
	return parsed >= 0 ? parsed : invalid(what);
}

function countOr(value: unknown, fallback: number, what: string): number {
	return value === null || value === undefined ? fallback : count(value, what);
}

function wholeOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : whole(value, what);
}

function countOrNull(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : count(value, what);
}

function instant(value: unknown, what: string): IsoInstant {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function instantOrNull(value: unknown, what: string): IsoInstant | null {
	return value === null || value === undefined ? null : instant(value, what);
}

function dayOrNull(value: unknown, what: string): IsoDate | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)
		? value.slice(0, 10)
		: invalid(what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

function known<T extends string>(
	allowed: readonly T[],
	value: unknown,
): T | null {
	return allowed.find((candidate) => candidate === value) ?? null;
}

function refused(row: Row): boolean {
	return (
		row.state === "refused" ||
		row.outcome === "refused" ||
		(typeof row.refusal === "string" && row.refusal !== "")
	);
}

export function maskedText(value: string): string {
	const digits = value.replace(/\D/g, "");
	if (digits.length <= 4) return value;
	return `•••• ••• ${digits.slice(-3)}`;
}

function masked(value: unknown, what: string): string {
	return maskedText(text(value, what));
}

function maskedOrNull(value: unknown, what: string): string | null {
	const found = textOrNull(value, what);
	return found === null ? null : maskedText(found);
}

function nested(row: Row, key: string): Row {
	const value = row[key];
	return isRecord(value) ? value : row;
}

export function checkinArgs(input: CheckinInput): Row {
	return input.entry.kind === "phone"
		? { p_store_id: input.storeId, p_phone: input.entry.phone }
		: { p_store_id: input.storeId, p_code: input.entry.code };
}

export function verifyArgs(storeId: string, code: string): Row {
	return { p_store_id: storeId, p_code: code };
}

export function lookupArgs(storeId: string, query: LookupQuery): Row {
	return query.kind === "phone"
		? { p_store_id: storeId, p_phone: query.phone }
		: { p_store_id: storeId, p_membership_id: query.membershipId };
}

export function requestArgs(input: RequestInput): Row {
	return {
		p_kind: input.kind,
		p_store_id: input.storeId,
		p_membership_id: input.membershipId,
		p_reason: input.reason,
		p_stamps: input.stamps,
		p_points: input.points,
	};
}

export function queueArgs(storeId: string): Row {
	return { p_store_id: storeId };
}

export function actionCall(action: QueueAction): {
	readonly fn: StaffLoyaltyFunction;
	readonly args: Row;
} {
	if (action.kind === "match") {
		return {
			fn: STAFF_LOYALTY_FUNCTIONS.resolveMatch,
			args: {
				p_item_id: action.itemId,
				p_choice: action.invoiceId,
				p_reason: action.reason,
			},
		};
	}
	return {
		fn: STAFF_LOYALTY_FUNCTIONS.decide,
		args: {
			p_request_id: action.itemId,
			p_decision: action.decision,
			p_reason: action.reason,
			p_stamps: action.stamps,
			p_points: action.points,
		},
	};
}

function readMemberSummary(row: Row): MemberSummary {
	const member = nested(row, "member");
	return {
		membershipId: textOrNull(member.membership_id, "membership"),
		phoneMasked: masked(member.phone_masked, "member phone"),
		displayName: textOrNull(member.display_name, "member name"),
		stamps: wholeOrNull(member.stamps, "member stamps"),
		stampsPerCard: countOrNull(member.stamps_per_card, "stamps per card"),
		points: wholeOrNull(member.points, "member points"),
	};
}

export function readCheckinAnswer(value: unknown): CheckinAnswer {
	const row = single(value, "check-in");
	if (refused(row)) {
		return {
			outcome: "refused",
			refusal: known(CHECKIN_REFUSALS, row.refusal),
			textKey: textOrNull(row.text_key, "refusal text key"),
		};
	}
	return {
		outcome: "recorded",
		checkinId: text(row.checkin_id, "check-in id"),
		state: oneOf(CHECKIN_STATES, row.state, "check-in state"),
		recordedAt: instant(row.recorded_at, "check-in time"),
		confirmBy: instantOrNull(row.confirm_by, "expected confirmation"),
		member: readMemberSummary(row),
	};
}

function readInstruction(
	row: Row,
	rail: RedemptionRail,
): RedemptionInstruction {
	if (rail === "pos_payment_discount") {
		return {
			kind: "pos_discount",
			discountName: text(row.pos_discount_name, "POS discount name"),
		};
	}
	return {
		kind: "voucher_code",
		voucherCode: text(row.voucher_code, "voucher code"),
	};
}

export function readRedemptionAnswer(value: unknown): RedemptionAnswer {
	const row = single(value, "redemption");
	if (refused(row)) {
		return {
			outcome: "refused",
			refusal: known(REDEMPTION_REFUSALS, row.refusal),
			textKey: textOrNull(row.text_key, "refusal text key"),
			usedAt: instantOrNull(row.used_at, "use time"),
			usedStoreName: textOrNull(row.used_store_name, "use store"),
			expiredAt: instantOrNull(row.expired_at, "expiry"),
		};
	}
	const rail = oneOf(REDEMPTION_RAILS, row.rail, "rail");
	return {
		outcome: "accepted",
		redemptionId: text(row.redemption_id, "redemption id"),
		rewardName: text(row.reward_name, "reward name"),
		rail,
		instruction: readInstruction(row, rail),
		minBillAmount: numberOrNull(row.min_bill_amount, "minimum bill"),
		holdUntil: instantOrNull(row.hold_until, "hold time"),
		confirmBy: instantOrNull(row.confirm_by, "expected confirmation"),
		phoneMasked: maskedOrNull(row.phone_masked, "member phone"),
	};
}

function readVisitPath(value: unknown): VisitPath {
	if (typeof value === "string" && LEDGER_PATHS[value] !== undefined)
		return LEDGER_PATHS[value];
	return oneOf(VISIT_PATHS, value, "visit path");
}

export function readVisit(value: unknown): Visit {
	const row = single(value, "visit");
	return {
		at: instant(row.at, "visit time"),
		state: oneOf(VISIT_STATES, row.state, "visit state"),
		path: readVisitPath(row.path),
		stamps: whole(row.stamps ?? 0, "visit stamps"),
		points: whole(row.points ?? 0, "visit points"),
		receiptNo: textOrNull(row.receipt_no, "receipt number"),
	};
}

export function readMemberCard(value: unknown): MemberCard {
	const row = single(value, "member card");
	return {
		membershipId: text(row.membership_id, "membership"),
		phoneMasked: masked(row.phone_masked, "member phone"),
		displayName: textOrNull(row.display_name, "member name"),
		memberSince: dayOrNull(row.member_since, "member since"),
		status: oneOf(MEMBERSHIP_STATUSES, row.status ?? "active", "status"),
		tierName: textOrNull(row.tier_name, "tier"),
		stamps: whole(row.stamps, "stamps"),
		stampsPerCard: count(row.stamps_per_card, "stamps per card"),
		stampsPending: countOr(row.stamps_pending, 0, "pending stamps"),
		points: whole(row.points, "points"),
		pointsPending: countOr(row.points_pending, 0, "pending points"),
	};
}

function readLimits(row: Row): AdjustLimits | null {
	if (
		(row.adjust_limit_stamps === null ||
			row.adjust_limit_stamps === undefined) &&
		(row.adjust_limit_points === null || row.adjust_limit_points === undefined)
	)
		return null;
	return {
		stamps: countOr(row.adjust_limit_stamps, 0, "stamp limit"),
		points: countOr(row.adjust_limit_points, 0, "point limit"),
	};
}

export function readLookupAnswer(value: unknown): LookupAnswer {
	if (value === null || (Array.isArray(value) && value.length === 0))
		return { found: false };
	const row = single(value, "member lookup");
	if (row.found === false) return { found: false };
	const card = isRecord(row.card) ? row.card : row;
	return {
		found: true,
		card: readMemberCard(card),
		storeName: textOrNull(row.store_name, "store name"),
		today: answerRows(row.today ?? [], "today's visits").map(readVisit),
		limits: readLimits(row),
	};
}

export function readRequestReceipt(value: unknown): RequestReceipt {
	const row = single(value, "request");
	return {
		requestId: text(row.request_id, "request id"),
		kind: oneOf(REQUEST_KINDS, row.kind, "request kind"),
		state: oneOf(REQUEST_STATES, row.state, "request state"),
	};
}

function readCandidate(value: unknown): MatchCandidate {
	const row = single(value, "candidate invoice");
	return {
		invoiceId: text(row.invoice_id, "candidate invoice"),
		receiptNo: textOrNull(row.receipt_no, "candidate receipt"),
		soldAt: instant(row.sold_at, "candidate time"),
		amount: number(row.amount, "candidate amount"),
	};
}

function readMatch(value: unknown): MatchDetails {
	const row = single(value, "match");
	const path = readVisitPath(row.path);
	if (path !== "member_code" && path !== "receipt_claim") invalid("match path");
	const candidates = answerRows(row.candidates, "candidates").map(
		readCandidate,
	);
	if (candidates.length < 2) invalid("candidates");
	return {
		path,
		recordedAt: instantOrNull(row.recorded_at, "recorded time"),
		amount: numberOrNull(row.amount, "recorded amount"),
		receiptNo: textOrNull(row.receipt_no, "claimed receipt"),
		candidates,
	};
}

export function readQueueItem(value: unknown): QueueItem {
	const row = single(value, "queue item");
	const kind = oneOf(QUEUE_KINDS, row.kind, "queue kind");
	return {
		id: text(row.id, "queue item id"),
		kind,
		storeId: text(row.store_id, "queue store"),
		createdAt: instant(row.created_at, "queue time"),
		phoneMasked: masked(row.phone_masked, "member phone"),
		requestedBy: textOrNull(row.requested_by_name, "requester"),
		reason: textOrNull(row.reason, "request reason"),
		stamps: whole(row.stamps ?? 0, "requested stamps"),
		points: whole(row.points ?? 0, "requested points"),
		match: kind === "match" ? readMatch(row.match) : null,
	};
}

export function readQueueOutcome(value: unknown): QueueOutcome {
	const row = single(value, "queue outcome");
	return {
		state: oneOf(QUEUE_OUTCOMES, row.state, "queue outcome"),
		refusal: textOrNull(row.refusal, "earn refusal"),
	};
}

export function readMyRequest(value: unknown): MyRequest {
	const row = single(value, "own request");
	return {
		id: text(row.id, "request id"),
		kind: oneOf(REQUEST_KINDS, row.kind, "request kind"),
		createdAt: instant(row.created_at, "request time"),
		phoneMasked: masked(row.phone_masked, "member phone"),
		reason: text(row.reason, "request reason"),
		stamps: whole(row.stamps ?? 0, "request stamps"),
		points: whole(row.points ?? 0, "request points"),
		state: oneOf(REQUEST_STATES, row.state, "request state"),
		decidedAt: instantOrNull(row.decided_at, "decision time"),
		decisionReason: textOrNull(row.decision_reason, "decision reason"),
		storeName: textOrNull(row.store_name, "store name"),
	};
}
