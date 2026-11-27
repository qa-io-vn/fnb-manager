import { type RestClient, RestError } from "@fnb/zalo-mini";
import {
	COUNTER_QR_PATTERN,
	CUSTOMER_FUNCTIONS,
	CUSTOMER_SESSION_KIND,
	ISO_DATE_PATTERN,
	MAX_CLAIM_AMOUNT,
	MAX_CLAIMS_PER_DAY,
	MEMBER_CODE_REFRESH_SECONDS,
	MEMBER_CODE_VALID_SECONDS,
	RECEIPT_NO_PATTERN,
	REFUSAL_INVALID,
	REFUSAL_NOT_MEMBER,
	UUID_PATTERN,
} from "@fnb/zalo-mini/loyalty";
import { addDays, creditEnd, isoDateIn, weekdayOf } from "../data/dates";
import {
	DEMO_BILL_RULES,
	DEMO_COUNTER_CODES,
	DEMO_CUSTOMER_ID,
	DEMO_DISPLAY_NAME,
	DEMO_LEGAL,
	DEMO_MEMBERSHIP_ID,
	DEMO_MENU,
	DEMO_OA_ID,
	DEMO_PHONE_MASKED,
	DEMO_PHONE_TOKEN,
	DEMO_PROGRAMME,
	DEMO_REDEEM_CODES,
	DEMO_REWARDS,
	DEMO_STAFF_BILLS,
	DEMO_STAFF_STORE,
	DEMO_STAMPS_PER_CARD,
	DEMO_STORES,
	DEMO_SYNCED_INVOICES,
	DEMO_TENANT_ID,
	DEMO_WELCOME_STAMPS,
	type DemoInvoice,
	type DemoReward,
} from "./fixtures";

export const DEMO_PROGRAMME_STATES = [
	"active",
	"paused",
	"ended",
	"none",
] as const;
export type DemoProgrammeState = (typeof DEMO_PROGRAMME_STATES)[number];

export const DEMO_DELETION_STATES = [
	"received",
	"in_progress",
	"rejected",
] as const;
export type DemoDeletionState = (typeof DEMO_DELETION_STATES)[number];

/**
 * How the stand-in network behaves. Off by default: the world answers at once and never fails. For the network failure
 * tests (`?net=` in the address): strict fails a call made or answered while the browser is offline like a dropped
 * request; lost-once commits the first change and loses its answer; error-once refuses it with a server error.
 */
export const DEMO_NETWORKS = [
	"none",
	"strict",
	"lost-once",
	"error-once",
] as const;
export type DemoNetwork = (typeof DEMO_NETWORKS)[number];

/** The reasons a native store holds orders (app.ordering_state), for `?ordering=` in the address. */
export const DEMO_ORDERING_REASONS = [
	"ordering_off",
	"hours_unknown",
	"closed_today",
	"paused",
	"closed_now",
	"last_orders_passed",
	"no_staff_online",
	"busy",
] as const;

/**
 * More functions the demo world answers, added by a build that has them (the ordering build adds the native till's
 * customer functions), so the loyalty build carries none of their code.
 */
export interface DemoExtension {
	/** the answer of one of its functions, or undefined for any other */
	answer(fn: string, args: Readonly<Record<string, unknown>>): unknown;
	/** its functions that change something (the network fault switches apply to them) */
	readonly changingFunctions: readonly string[];
	/**
	 * The answer of one of its Edge Functions (POST /functions/v1/<name> with a JSON body) as a status and a JSON body,
	 * or undefined for any other: the ordering build's stand-in checkout-order. Every call to one changes something.
	 */
	call?(
		name: string,
		body: unknown,
	): { readonly status: number; readonly body: unknown } | undefined;
}

export type DemoSessionRefusal = "never" | "once" | "always";

export interface DemoSettings {
	readonly member: boolean;
	readonly marketing: boolean;
	readonly sessionFailure: boolean;
	/**
	 * The sign-in is refused the way the cloud refuses a Zalo token it cannot check (401 zalo_token_refused, the answer
	 * a wrong Zalo App secret gives, G-109): `?session=refused` every time, `?session=refused-once` only the first time.
	 */
	readonly sessionRefused: DemoSessionRefusal;
	readonly claimsUsed: number;
	readonly delayMs: number;
	readonly programme: DemoProgrammeState;
	readonly privacy: boolean;
	readonly vouchers: boolean;
	readonly stores: boolean;
	readonly deletion: DemoDeletionState | null;
	readonly network: DemoNetwork;
	readonly answerDelayMs: number;
	/**
	 * Store mau-1 runs loyalty in staff mode with counter claims (`?staff=1`, implied by `?bill=`): the receipt claim
	 * is refused there with staff_mode, and the counter QR DEMO_COUNTER_QR earns. Counter claims up to
	 * DEMO_BILL_RULES.autoApproveMax are confirmed at once (auto approval); larger ones wait for a staff member.
	 */
	readonly staffMode: boolean;
	/** how many staff-recorded bills wait for the member's blind total (`?bill=1` to 3, members only) */
	readonly bills: number;
	/** the reason the ordering store holds orders from the start (`?ordering=paused` and so on); null takes orders */
	readonly orderingReason: string | null;
	/**
	 * The ordering store offers the two online ways to pay besides the counter (`?payments=online`), as a store whose
	 * providers are configured does; otherwise the counter only, and checkout-order answers provider_off.
	 */
	readonly onlinePayments: boolean;
}

export const DEMO_DEFAULTS: DemoSettings = {
	member: false,
	marketing: false,
	sessionFailure: false,
	sessionRefused: "never",
	claimsUsed: 0,
	delayMs: 0,
	programme: "active",
	privacy: true,
	vouchers: false,
	stores: true,
	deletion: null,
	network: "none",
	answerDelayMs: 0,
	staffMode: false,
	bills: 0,
	orderingReason: null,
	onlinePayments: false,
};

const MAX_DEMO_DELAY_MS = 10_000;
export const DEMO_DELETION_REQUEST_ID = "00000000-0000-4000-8000-00000000d001";
export const DEMO_EARLIER_DELETION_REQUEST_ID =
	"00000000-0000-4000-8000-00000000d000";
const SESSION_SECONDS = 3600;
const UNKNOWN_TOKEN = "PGRST301";

export function demoSettingsFrom(search: string): DemoSettings {
	const params = new URLSearchParams(search);
	const delay = Number(params.get("dataDelay") ?? "0");
	const claims = Number(params.get("claims") ?? "0");
	const answerDelay = Number(params.get("answerDelay") ?? "0");
	const member = params.get("member") === "1";
	const programme =
		DEMO_PROGRAMME_STATES.find((state) => state === params.get("programme")) ??
		"active";
	const deletion =
		DEMO_DELETION_STATES.find((state) => state === params.get("deletion")) ??
		null;
	const billCount = Number(params.get("bill") ?? "0");
	const bills =
		member && Number.isInteger(billCount) && billCount > 0
			? Math.min(billCount, DEMO_STAFF_BILLS.length)
			: 0;
	return {
		member,
		marketing: member && params.get("marketing") === "1",
		sessionFailure: params.get("session") === "failed",
		sessionRefused:
			params.get("session") === "refused"
				? "always"
				: params.get("session") === "refused-once"
					? "once"
					: "never",
		claimsUsed:
			Number.isInteger(claims) && claims > 0
				? Math.min(claims, MAX_CLAIMS_PER_DAY)
				: 0,
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_DEMO_DELAY_MS)
				: 0,
		programme: member && programme === "none" ? "active" : programme,
		privacy: params.get("privacy") !== "none",
		vouchers: member && params.get("vouchers") === "1",
		stores: params.get("stores") !== "none",
		deletion: member ? deletion : null,
		network: DEMO_NETWORKS.find((name) => name === params.get("net")) ?? "none",
		answerDelayMs:
			Number.isInteger(answerDelay) && answerDelay > 0
				? Math.min(answerDelay, MAX_DEMO_DELAY_MS)
				: 0,
		staffMode: params.get("staff") === "1" || bills > 0,
		bills,
		orderingReason:
			DEMO_ORDERING_REASONS.find((name) => name === params.get("ordering")) ??
			null,
		onlinePayments: params.get("payments") === "online",
	};
}

interface Entry {
	id: string;
	at: number;
	kind: "welcome" | "earn" | "reversal" | "redeem" | "adjust";
	state: "pending" | "confirmed" | "reversed";
	stamps: number;
	points: number;
	store: string | null;
	receiptNo: string | null;
	path: "welcome" | "phone" | "member_code" | "receipt_claim" | "bill" | null;
	reason?: string;
}

/** A bill of path E: recorded by a staff member (staff_scan) or claimed with the counter QR (counter_claim). */
interface Bill {
	readonly id: string;
	readonly store: string;
	readonly billNo: string;
	readonly total: number;
	readonly source: "staff_scan" | "counter_claim";
	readonly recordedAt: number;
	readonly confirmBy: number;
	readonly counterToken: string | null;
	state:
		| "awaiting_customer"
		| "awaiting_staff"
		| "confirmed"
		| "queued"
		| "reversed";
	evidenceLevel: number;
	answered: boolean;
	/** the outcome the customer was given for their answer, sent back when the same answer comes again (G-92) */
	firstOutcome: "awaiting_staff" | "confirmed" | "queued" | null;
	disputed: boolean;
	decidedAt: number | null;
	entryId: string | null;
}

/** How long a decided counter claim stays in the wallet, and how many it lists, as app.customer_counter_claims. */
const COUNTER_CLAIM_DAYS = 7;
const COUNTER_CLAIMS_LISTED = 20;

function billKey(billNo: string): string {
	const upper = billNo.trim().toUpperCase();
	return /^0+$/.test(upper) ? "0" : upper.replace(/^0+/, "");
}

function billPoints(total: number): number {
	return Math.floor(total / 1000);
}

interface DemoVoucher {
	readonly id: string;
	readonly reward: DemoReward;
	readonly store: string;
	readonly code: string;
	readonly heldAt: number;
	readonly holdExpiresAt: number;
	state: "held" | "confirmed" | "released";
	confirmedAt: number | null;
	releasedAt: number | null;
	readonly entryId: string;
}

interface Claim {
	id: string;
	store: string;
	receiptNo: string;
	businessDate: string;
	submittedAt: number;
	state: "pending" | "matched" | "rejected";
	reason: string | null;
}

const CHANGING_FUNCTIONS: ReadonlySet<string> = new Set([
	CUSTOMER_FUNCTIONS.submitClaim,
	CUSTOMER_FUNCTIONS.redeem,
	CUSTOMER_FUNCTIONS.stopMarketing,
	CUSTOMER_FUNCTIONS.requestDeletion,
	CUSTOMER_FUNCTIONS.confirmBill,
	CUSTOMER_FUNCTIONS.disputeBill,
	CUSTOMER_FUNCTIONS.submitCounterClaim,
]);

function browserOffline(): boolean {
	return typeof navigator !== "undefined" && navigator.onLine === false;
}

export interface DemoWorld {
	readonly settings: DemoSettings;
	readonly sessionFetch: typeof fetch;
	/**
	 * The Edge Functions an extension answers (POST <anything>/functions/v1/<name>), at the wire level: the session's
	 * bearer token checked as the Data API checks it, the same faults and delays, JSON answers with their status.
	 */
	readonly functionFetch: typeof fetch;
	rest(accessToken: string): RestClient;
	joined(): boolean;
	marketing(): boolean;
	deletionRequested(): boolean;
	setOffline(offline: boolean): void;
	/** adds the functions of an extension (once; a second call replaces the first) */
	extend(extension: DemoExtension): void;
	/** the world's clock */
	now(): number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DEMO_COMPLETION_DAYS = 20;

interface DemoDeletion {
	readonly request_id: string;
	readonly status: DemoDeletionState;
	readonly requested_at: string;
	readonly first_response_due_at: string;
	readonly completion_due_at: string;
}

export function demoDeletion(
	requestId: string,
	status: DemoDeletionState,
	at: number,
): DemoDeletion {
	const day = isoDateIn(at);
	let days = 0;
	for (let working = 0; working < 2; ) {
		days += 1;
		const weekday = weekdayOf(addDays(day, days));
		if (weekday !== "sat" && weekday !== "sun") working += 1;
	}
	return {
		request_id: requestId,
		status,
		requested_at: new Date(at).toISOString(),
		first_response_due_at: new Date(at + days * DAY_MS).toISOString(),
		completion_due_at: new Date(
			at + DEMO_COMPLETION_DAYS * DAY_MS,
		).toISOString(),
	};
}

export function demoReceiptNo(invoice: DemoInvoice, today: string): string {
	return invoice.receiptNo.replace(
		"DD",
		addDays(today, -invoice.daysAgo).slice(8, 10),
	);
}

function storeName(code: string | null): string | null {
	return DEMO_STORES.find((store) => store.code === code)?.name ?? null;
}

function memberCodeOf(
	customerId: string,
	store: string,
	window: number,
): string {
	let hash = 2166136261;
	for (const char of `${customerId}|${store}|${window}`) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return String(hash % 1_000_000).padStart(6, "0");
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function textField(
	record: Readonly<Record<string, unknown>>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

export function createDemoWorld(
	settings: DemoSettings = DEMO_DEFAULTS,
	now: () => number = Date.now,
): DemoWorld {
	const tokens = new Map<string, boolean>();
	let tokenCount = 0;
	let joined = settings.member;
	let marketing = settings.marketing;
	let memberSince = isoDateIn(now() - 40 * DAY_MS);
	let entryCount = 0;
	let claimCount = 0;
	let deletion: DemoDeletion | null =
		settings.deletion === null
			? null
			: demoDeletion(
					DEMO_EARLIER_DELETION_REQUEST_ID,
					settings.deletion,
					now() - DAY_MS,
				);
	let offline = false;
	let faultSpent = false;
	const strict = settings.network !== "none";
	let extension: DemoExtension | null = null;
	const entries: Entry[] = [];
	const claims: Claim[] = [];
	const vouchers: DemoVoucher[] = [];
	let voucherCount = 0;
	const extraClaimsToday = settings.claimsUsed;
	const claimsDay = isoDateIn(now());

	const entry = (value: Omit<Entry, "id">): void => {
		entryCount += 1;
		entries.push({ id: `demo-entry-${entryCount}`, ...value });
	};

	if (settings.member) {
		const start = now();
		entry({
			at: start - 40 * DAY_MS,
			kind: "welcome",
			state: "confirmed",
			stamps: DEMO_WELCOME_STAMPS,
			points: 0,
			store: null,
			receiptNo: null,
			path: "welcome",
		});
		entry({
			at: start - 10 * DAY_MS,
			kind: "earn",
			state: "confirmed",
			stamps: 1,
			points: 45,
			store: "mau-1",
			receiptNo: "0101",
			path: "phone",
		});
		entry({
			at: start - 6 * DAY_MS,
			kind: "earn",
			state: "reversed",
			stamps: 1,
			points: 25,
			store: "mau-1",
			receiptNo: "0099",
			path: "phone",
		});
		entry({
			at: start - 3 * DAY_MS,
			kind: "earn",
			state: "confirmed",
			stamps: 1,
			points: 60,
			store: "mau-2",
			receiptNo: null,
			path: "member_code",
		});
		entry({
			at: start - HOUR_MS,
			kind: "earn",
			state: "pending",
			stamps: 1,
			points: 30,
			store: "mau-1",
			receiptNo: null,
			path: "member_code",
		});
	}

	const addVoucher = (
		reward: DemoReward,
		store: string,
		heldAt: number,
	): DemoVoucher => {
		voucherCount += 1;
		entry({
			at: heldAt,
			kind: "redeem",
			state: "pending",
			stamps: -reward.cost_stamps,
			points: -reward.cost_points,
			store,
			receiptNo: null,
			path: null,
			reason: "redemption",
		});
		const voucher: DemoVoucher = {
			id: `00000000-0000-4000-8000-${String(voucherCount).padStart(12, "0")}`,
			reward,
			store,
			code:
				DEMO_REDEEM_CODES[(voucherCount - 1) % DEMO_REDEEM_CODES.length] ??
				"K7M2Q9TX",
			heldAt,
			holdExpiresAt: heldAt + reward.hold_hours * HOUR_MS,
			state: "held",
			confirmedAt: null,
			releasedAt: null,
			entryId: `demo-entry-${entryCount}`,
		};
		vouchers.push(voucher);
		return voucher;
	};

	const settle = (
		voucher: DemoVoucher,
		state: "confirmed" | "released",
		at: number,
	): void => {
		const held = entries.find((value) => value.id === voucher.entryId);
		if (held !== undefined)
			held.state = state === "confirmed" ? "confirmed" : "reversed";
		voucher.state = state;
		if (state === "confirmed") {
			voucher.confirmedAt = at;
			return;
		}
		voucher.releasedAt = at;
		entry({
			at,
			kind: "adjust",
			state: "confirmed",
			stamps: voucher.reward.cost_stamps,
			points: voucher.reward.cost_points,
			store: null,
			receiptNo: null,
			path: null,
			reason: "redemption_released",
		});
	};

	if (settings.vouchers) {
		const start = now();
		const [coffee, cookie] = DEMO_REWARDS;
		if (cookie !== undefined) {
			const used = addVoucher(cookie, "mau-1", start - 5 * DAY_MS);
			settle(used, "confirmed", start - 5 * DAY_MS + 20 * 60_000);
		}
		if (coffee !== undefined) {
			const returned = addVoucher(coffee, "mau-2", start - 3 * DAY_MS);
			settle(returned, "released", returned.holdExpiresAt);
		}
	}

	const bills: Bill[] = [];
	let counterFailures = 0;
	let counterLockedUntil = 0;
	const staffStore = (store: string): boolean =>
		(settings.staffMode || settings.bills > 0) && store === DEMO_STAFF_STORE;

	const billEntry = (bill: Bill, state: Entry["state"]): string => {
		entry({
			at: bill.recordedAt,
			kind: "earn",
			state,
			stamps: 1,
			points: billPoints(bill.total),
			store: bill.store,
			receiptNo: bill.billNo,
			path: "bill",
		});
		return `demo-entry-${entryCount}`;
	};

	const settleBill = (bill: Bill, state: "confirmed" | "reversed"): void => {
		const earn = entries.find((value) => value.id === bill.entryId);
		if (earn !== undefined) earn.state = state;
	};

	for (const seeded of DEMO_STAFF_BILLS.slice(0, settings.bills)) {
		const recordedAt = now() - seeded.minutesAgo * 60_000;
		const bill: Bill = {
			id: seeded.id,
			store: DEMO_STAFF_STORE,
			billNo: seeded.billNo,
			total: seeded.staffTotal,
			source: "staff_scan",
			recordedAt,
			confirmBy: recordedAt + DEMO_BILL_RULES.unconfirmedHours * HOUR_MS,
			counterToken: null,
			state: "awaiting_customer",
			evidenceLevel: 0,
			answered: false,
			firstOutcome: null,
			disputed: false,
			decidedAt: null,
			entryId: null,
		};
		bill.entryId = billEntry(bill, "pending");
		bills.push(bill);
	}

	const pause = (): Promise<void> =>
		settings.delayMs > 0
			? new Promise((resolve) => setTimeout(resolve, settings.delayMs))
			: Promise.resolve();

	const issue = (member: boolean): Record<string, unknown> => {
		tokenCount += 1;
		const token = `demo-${member ? "member" : "visitor"}-${tokenCount}`;
		tokens.set(token, member);
		return {
			status: CUSTOMER_SESSION_KIND,
			access_token: token,
			refresh_token: `demo-refresh-${tokenCount}`,
			expires_at: Math.floor(now() / 1000) + SESSION_SECONDS,
			customer: {
				tenant_id: DEMO_TENANT_ID,
				customer_id: member ? DEMO_CUSTOMER_ID : null,
				display_name: DEMO_DISPLAY_NAME,
			},
		};
	};

	const joinAnswer = (join: Readonly<Record<string, unknown>>): Response => {
		if (join.loyalty_consent !== true)
			return json({ error: "loyalty_consent_required" }, 400);
		if (
			!settings.privacy ||
			textField(join, "policy_version") !== DEMO_LEGAL.policy_version
		)
			return json({ error: "policy_outdated" }, 409);
		if (settings.programme !== "active")
			return json({ error: "no_programme" }, 409);
		const store = join.store;
		if (
			store !== null &&
			store !== undefined &&
			storeName(String(store)) === null
		)
			return json({ error: "unknown_store" }, 404);
		if (textField(join, "phone_token") !== DEMO_PHONE_TOKEN)
			return json({ error: "phone_token_refused" }, 422);
		const already = joined;
		if (!already) {
			joined = true;
			marketing = join.marketing_consent === true;
			memberSince = isoDateIn(now());
			entry({
				at: now(),
				kind: "welcome",
				state: "confirmed",
				stamps: DEMO_WELCOME_STAMPS,
				points: 0,
				store: null,
				receiptNo: null,
				path: "welcome",
			});
		}
		return json({
			...issue(true),
			joined: {
				membership_id: DEMO_MEMBERSHIP_ID,
				welcome_stamps: already ? 0 : DEMO_WELCOME_STAMPS,
				already_member: already,
			},
		});
	};

	let sessionRefusals = 0;
	const sessionFetch: typeof fetch = async (_input, init) => {
		await pause();
		if (settings.sessionFailure) throw new TypeError("demo network failure");
		if (
			settings.sessionRefused === "always" ||
			(settings.sessionRefused === "once" && sessionRefusals === 0)
		) {
			sessionRefusals += 1;
			return json({ error: "zalo_token_refused", request_id: "demo" }, 401);
		}
		const body: unknown =
			typeof init?.body === "string" ? JSON.parse(init.body) : null;
		if (typeof body !== "object" || body === null)
			return json({ error: "invalid_request" }, 400);
		const request = body as Readonly<Record<string, unknown>>;
		if (request.kind !== CUSTOMER_SESSION_KIND)
			return json({ error: "invalid_kind" }, 400);
		const join = request.join;
		if (typeof join === "object" && join !== null)
			return joinAnswer(join as Readonly<Record<string, unknown>>);
		return json(issue(joined));
	};

	const confirmed = (value: Entry) => value.state === "confirmed";
	const counted = (value: Entry) => confirmed(value) || value.kind === "redeem";
	const waiting = (value: Entry) =>
		value.state === "pending" && value.kind === "earn";

	const claimsToday = (): number =>
		extraClaimsToday +
		claims.filter((claim) => isoDateIn(claim.submittedAt) === isoDateIn(now()))
			.length;

	// ADR-047: a credit is spendable until the midnight that closes its last valid
	// day, read at this instant like app.loyalty_balance, not at the nightly run.
	const stampEnd = (value: Entry) =>
		creditEnd(value.at, DEMO_PROGRAMME.stamp_validity_months);
	const pointsEnd = (value: Entry) =>
		creditEnd(value.at, DEMO_PROGRAMME.points_expiry_months);
	const credit = (value: Entry) =>
		confirmed(value) && value.kind !== "redeem" && value.kind !== "reversal";
	const balance = (): { readonly stamps: number; readonly points: number } => {
		const at = now();
		const rows = entries.filter(counted);
		const ended = (
			part: "stamps" | "points",
			end: (value: Entry) => { expiresAt: number },
		) =>
			rows
				.filter(
					(value) =>
						credit(value) && value[part] > 0 && end(value).expiresAt <= at,
				)
				.reduce((sum, value) => sum + value[part], 0);
		return {
			stamps: Math.max(
				rows.reduce((sum, value) => sum + value.stamps, 0) -
					ended("stamps", stampEnd),
				0,
			),
			points: Math.max(
				rows.reduce((sum, value) => sum + value.points, 0) -
					ended("points", pointsEnd),
				0,
			),
		};
	};

	const rewardAt = (store: string | null) => (reward: DemoReward) =>
		store === null ||
		reward.store_codes === null ||
		reward.store_codes.includes(store);

	const liveVoucher = (reward: DemoReward): DemoVoucher | undefined =>
		vouchers.find(
			(voucher) =>
				voucher.reward.coupon_id === reward.coupon_id &&
				voucher.state === "held" &&
				voucher.holdExpiresAt > now(),
		);

	const redeemedCount = (reward: DemoReward): number =>
		vouchers.filter(
			(voucher) =>
				voucher.reward.coupon_id === reward.coupon_id &&
				voucher.state !== "released",
		).length;

	const rewardReason = (reward: DemoReward): string | null => {
		const { stamps, points } = balance();
		if (liveVoucher(reward) !== undefined) return "already_held";
		if (
			reward.per_member_limit !== null &&
			redeemedCount(reward) >= reward.per_member_limit
		)
			return "member_limit_reached";
		if (reward.cost_stamps > stamps) return "insufficient_stamps";
		if (reward.cost_points > points) return "insufficient_points";
		return null;
	};

	const rewards = (store: unknown): unknown[] => {
		if (store !== null && store !== undefined) {
			if (typeof store !== "string" || storeName(store) === null)
				throw new RestError(400, REFUSAL_INVALID);
		}
		const { stamps, points } = balance();
		const at = typeof store === "string" ? store : null;
		return DEMO_REWARDS.filter(rewardAt(at)).map((reward) => {
			const reason = rewardReason(reward);
			return {
				...reward,
				redeemed: redeemedCount(reward),
				live_redemption_id: liveVoucher(reward)?.id ?? null,
				affordable:
					reward.cost_stamps <= stamps && reward.cost_points <= points,
				stamps_short: Math.max(reward.cost_stamps - stamps, 0),
				points_short: Math.max(reward.cost_points - points, 0),
				available: reason === null,
				unavailable_reason: reason,
			};
		});
	};

	const redeem = (
		args: Readonly<Record<string, unknown>>,
	): Record<string, unknown> => {
		const store = textField(args, "p_store");
		const reward = DEMO_REWARDS.find(
			(candidate) => candidate.coupon_id === args.p_coupon,
		);
		if (store === null || storeName(store) === null || reward === undefined)
			throw new RestError(400, REFUSAL_INVALID);
		const refusal = rewardAt(store)(reward)
			? rewardReason(reward)
			: "store_unavailable";
		if (refusal !== null) {
			const { stamps, points } = balance();
			return {
				redemption_id: null,
				state: null,
				refusal,
				store_code: store,
				store_name: storeName(store),
				stamps,
				points,
			};
		}
		const voucher = addVoucher(reward, store, now());
		const { stamps, points } = balance();
		return {
			redemption_id: voucher.id,
			state: "held",
			refusal: null,
			code: voucher.code,
			qr_payload: `fnb-redeem:1:${voucher.code}`,
			rail: "pos_payment_discount",
			coupon_id: reward.coupon_id,
			store_id: `demo-store-${store}`,
			store_code: store,
			store_name: storeName(store),
			held_at: new Date(voucher.heldAt).toISOString(),
			hold_expires_at: new Date(voucher.holdExpiresAt).toISOString(),
			seconds_left: Math.floor((voucher.holdExpiresAt - now()) / 1000),
			stamps_spent: reward.cost_stamps,
			points_spent: reward.cost_points,
			stamps,
			points,
		};
	};

	const voucherList = (): unknown[] => {
		const at = now();
		const live = (voucher: DemoVoucher) =>
			voucher.state === "held" && voucher.holdExpiresAt > at;
		return [...vouchers]
			.sort(
				(left, right) =>
					Number(right.state === "held") - Number(left.state === "held") ||
					right.heldAt - left.heldAt,
			)
			.map((voucher) => ({
				redemption_id: voucher.id,
				coupon_id: voucher.reward.coupon_id,
				coupon_name: voucher.reward.name,
				reward_kind: voucher.reward.reward_kind,
				reward_percent: voucher.reward.reward_percent,
				store_code: voucher.store,
				store_name: storeName(voucher.store),
				code: live(voucher) ? voucher.code : null,
				qr_payload: live(voucher) ? `fnb-redeem:1:${voucher.code}` : null,
				state: voucher.state,
				display_state: live(voucher)
					? "held"
					: voucher.state === "held"
						? "expired"
						: voucher.state === "confirmed"
							? "used"
							: "returned",
				held_at: new Date(voucher.heldAt).toISOString(),
				hold_expires_at: new Date(voucher.holdExpiresAt).toISOString(),
				seconds_left:
					voucher.state === "held"
						? Math.max(Math.floor((voucher.holdExpiresAt - at) / 1000), 0)
						: null,
				verified: voucher.state === "confirmed",
				confirmed_at:
					voucher.confirmedAt === null
						? null
						: new Date(voucher.confirmedAt).toISOString(),
				released_at:
					voucher.releasedAt === null
						? null
						: new Date(voucher.releasedAt).toISOString(),
				stamps_spent: voucher.reward.cost_stamps,
				points_spent: voucher.reward.cost_points,
			}));
	};

	const wallet = (): Record<string, unknown> => {
		const { stamps, points } = balance();
		const pendingStamps = entries
			.filter(waiting)
			.reduce((sum, value) => sum + value.stamps, 0);
		const pendingPoints = entries
			.filter(waiting)
			.reduce((sum, value) => sum + value.points, 0);
		const tiers = DEMO_PROGRAMME.tiers;
		const tierIndex = tiers.reduce(
			(found, tier, index) => (points >= tier.min_points ? index : found),
			0,
		);
		const tier = tiers[tierIndex] ?? tiers[0];
		const next = tiers[tierIndex + 1] ?? null;
		const live = (end: { expiresAt: number }) => end.expiresAt > now();
		const firstEarn = entries.find(
			(value) => confirmed(value) && value.points > 0 && live(pointsEnd(value)),
		);
		const firstEarnEnd =
			firstEarn === undefined ? undefined : pointsEnd(firstEarn);
		const nextStamp = entries
			.filter((value) => credit(value) && value.stamps > 0)
			.map(stampEnd)
			.filter(live)
			.sort((left, right) => left.expiresAt - right.expiresAt)[0];
		return {
			card: {
				programme_name: DEMO_PROGRAMME.name,
				display_name: DEMO_DISPLAY_NAME,
				phone_masked: DEMO_PHONE_MASKED,
				member_since: memberSince,
				purchases: entries.filter(
					(value) => confirmed(value) && value.kind === "earn",
				).length,
			},
			stamp_cards: [
				{
					id: "demo-card-1",
					name: DEMO_PROGRAMME.reward_summary,
					stamps: stamps % DEMO_STAMPS_PER_CARD,
					stamps_per_card: DEMO_STAMPS_PER_CARD,
					pending: pendingStamps,
					expires_on: nextStamp?.validThrough ?? null,
					valid_through: nextStamp?.validThrough ?? null,
					expires_at:
						nextStamp === undefined
							? null
							: new Date(nextStamp.expiresAt).toISOString(),
				},
			],
			points: {
				balance: points,
				pending: pendingPoints,
				expiring:
					firstEarn === undefined || firstEarnEnd === undefined
						? null
						: {
								points: firstEarn.points,
								on: firstEarnEnd.validThrough,
								valid_through: firstEarnEnd.validThrough,
								expires_at: new Date(firstEarnEnd.expiresAt).toISOString(),
							},
			},
			tier:
				tier === undefined
					? null
					: {
							code: tier.code,
							name: tier.name,
							next_name: next?.name ?? null,
							points_to_next: next === null ? null : next.min_points - points,
						},
			marketing_consent: marketing,
			history: [...entries]
				.sort((left, right) => right.at - left.at)
				.map((value) => ({
					id: value.id,
					at: new Date(value.at).toISOString(),
					kind: value.kind,
					state: value.state,
					stamps: value.stamps,
					points: value.points,
					store_name: storeName(value.store),
					receipt_no: value.receiptNo,
					reason: value.reason ?? (value.kind === "welcome" ? "welcome" : null),
					matched_path: value.path,
				})),
			claims: [...claims]
				.sort((left, right) => right.submittedAt - left.submittedAt)
				.map((claim) => ({
					id: claim.id,
					store_name: storeName(claim.store),
					receipt_no: claim.receiptNo,
					business_date: claim.businessDate,
					submitted_at: new Date(claim.submittedAt).toISOString(),
					state: claim.state,
					reason: claim.reason,
				})),
			claims_today: claimsToday(),
			claims_per_day: MAX_CLAIMS_PER_DAY,
			bills_to_confirm: bills
				.filter(
					(bill) =>
						bill.state === "awaiting_customer" &&
						!bill.answered &&
						bill.confirmBy > now() &&
						bill.recordedAt <= now(),
				)
				.sort((left, right) => right.recordedAt - left.recordedAt)
				.map((bill) => ({
					id: bill.id,
					store_name: storeName(bill.store),
					bill_no: bill.billNo,
					recorded_at: new Date(bill.recordedAt).toISOString(),
					confirm_by: new Date(bill.confirmBy).toISOString(),
				})),
			counter_claims: bills
				.filter(
					(bill) =>
						bill.source === "counter_claim" &&
						bill.recordedAt <= now() &&
						(bill.state === "awaiting_staff" ||
							bill.state === "queued" ||
							bill.recordedAt > now() - COUNTER_CLAIM_DAYS * DAY_MS),
				)
				.sort((left, right) => right.recordedAt - left.recordedAt)
				.slice(0, COUNTER_CLAIMS_LISTED)
				.map((bill) => ({
					id: bill.id,
					store_name: storeName(bill.store),
					bill_no: bill.billNo,
					submitted_at: new Date(bill.recordedAt).toISOString(),
					state: bill.state,
					waiting_until:
						bill.state === "awaiting_staff"
							? new Date(bill.confirmBy).toISOString()
							: null,
					decided_at:
						bill.decidedAt === null
							? null
							: new Date(bill.decidedAt).toISOString(),
				})),
			deletion_request: deletion,
		};
	};

	const validTotal = (value: unknown): number => {
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			value <= 0 ||
			value > MAX_CLAIM_AMOUNT
		)
			throw new RestError(400, REFUSAL_INVALID);
		return value;
	};

	const ownBill = (args: Readonly<Record<string, unknown>>): Bill | null => {
		const id = textField(args, "p_bill_id");
		// PostgREST answers a malformed uuid with invalid_text_representation
		if (id === null || !UUID_PATTERN.test(id))
			throw new RestError(400, "22P02");
		return bills.find((bill) => bill.id === id) ?? null;
	};

	const confirmBill = (
		args: Readonly<Record<string, unknown>>,
	): Record<string, unknown> => {
		const total = validTotal(args.p_total);
		const bill = ownBill(args);
		if (bill === null) return { state: "refused", refusal: "unknown_bill" };
		// the same customer answering again (a lost answer): the first outcome, whatever total comes the second time
		if (bill.answered && !bill.disputed && bill.firstOutcome !== null)
			return {
				state: bill.firstOutcome,
				refusal: null,
				evidence_level: bill.evidenceLevel,
				replayed: true,
			};
		if (bill.state !== "awaiting_customer" || bill.answered)
			return { state: "refused", refusal: "already_answered" };
		if (bill.confirmBy <= now())
			return { state: "refused", refusal: "too_late" };
		bill.answered = true;
		if (Math.abs(bill.total - total) <= DEMO_BILL_RULES.tolerance) {
			bill.state = "confirmed";
			bill.evidenceLevel = 2;
			bill.decidedAt = now();
			settleBill(bill, "confirmed");
		} else {
			bill.state = "queued";
		}
		bill.firstOutcome = bill.state;
		return {
			state: bill.state,
			refusal: null,
			evidence_level: bill.evidenceLevel,
			replayed: false,
		};
	};

	const disputeBill = (
		args: Readonly<Record<string, unknown>>,
	): Record<string, unknown> => {
		const bill = ownBill(args);
		if (bill === null) return { state: "refused", refusal: "unknown_bill" };
		if (bill.disputed)
			return { state: "reversed", refusal: null, replayed: true };
		if (bill.state !== "awaiting_customer" || bill.answered)
			return { state: "refused", refusal: "already_answered" };
		bill.answered = true;
		bill.disputed = true;
		bill.state = "reversed";
		bill.decidedAt = now();
		settleBill(bill, "reversed");
		return { state: "reversed", refusal: null, replayed: false };
	};

	const counterClaimRefusal = (
		store: string,
		expired: boolean,
		token: string,
		billNo: string,
		total: number,
	): string | null => {
		if (!staffStore(store)) return "not_available";
		if (expired) return "code_expired";
		if (bills.some((bill) => bill.counterToken === token)) return "code_used";
		const today = isoDateIn(now());
		if (
			bills.filter(
				(bill) =>
					bill.source === "counter_claim" &&
					isoDateIn(bill.recordedAt) === today,
			).length >= DEMO_BILL_RULES.counterClaimsPerDay
		)
			return "daily_limit";
		if (total > DEMO_BILL_RULES.maxBill) return "over_bill_limit";
		const known = bills.find(
			(bill) =>
				bill.store === store &&
				isoDateIn(bill.recordedAt) === today &&
				billKey(bill.billNo) === billKey(billNo) &&
				bill.state !== "reversed",
		);
		if (known !== undefined)
			return known.total === total ? "bill_used" : "bill_conflict";
		if (total < DEMO_BILL_RULES.minimum) return "below_minimum";
		return null;
	};

	const submitCounterClaim = (
		args: Readonly<Record<string, unknown>>,
	): Record<string, unknown> => {
		const raw = (textField(args, "p_qr") ?? "").trim();
		const billNo = (textField(args, "p_bill_no") ?? "").trim();
		if (!COUNTER_QR_PATTERN.test(raw) || !RECEIPT_NO_PATTERN.test(billNo))
			throw new RestError(400, REFUSAL_INVALID);
		const total = validTotal(args.p_total);
		if (counterLockedUntil > now())
			return {
				state: "refused",
				refusal: "locked",
				bill_id: null,
				retry_at: new Date(counterLockedUntil).toISOString(),
			};
		const [, , store = "", token = ""] = raw.split(":");
		const code = DEMO_COUNTER_CODES.find(
			(candidate) => candidate.token === token,
		);
		if (code === undefined || code.store !== store) {
			counterFailures += 1;
			if (counterFailures >= DEMO_BILL_RULES.lockAfter) {
				counterFailures = 0;
				counterLockedUntil = now() + DEMO_BILL_RULES.lockMinutes * 60_000;
			}
			return {
				state: "refused",
				refusal: code === undefined ? "code_unknown" : "wrong_store",
				bill_id: null,
			};
		}
		// the same bill sent again with this QR (a lost answer): the first outcome, even once the QR has expired
		const first = bills.find(
			(bill) =>
				bill.counterToken === token && billKey(bill.billNo) === billKey(billNo),
		);
		if (first !== undefined && first.firstOutcome === "awaiting_staff")
			return {
				state: "awaiting_staff",
				refusal: null,
				bill_id: first.id,
				evidence_level: first.evidenceLevel,
				expires_at: new Date(first.confirmBy).toISOString(),
				replayed: true,
			};
		if (first !== undefined && first.firstOutcome === "confirmed")
			return {
				state: "confirmed",
				refusal: null,
				bill_id: first.id,
				evidence_level: first.evidenceLevel,
				stamps_earned: 1,
				points_earned: billPoints(first.total),
				replayed: true,
			};
		const refusal = counterClaimRefusal(
			store,
			code.expired,
			token,
			billNo,
			total,
		);
		if (refusal !== null) return { state: "refused", refusal, bill_id: null };
		const at = now();
		const automatic = total <= DEMO_BILL_RULES.autoApproveMax;
		const bill: Bill = {
			id: `00000000-0000-4000-8000-${String(bills.length + 0xc00).padStart(12, "0")}`,
			store,
			billNo,
			total,
			source: "counter_claim",
			recordedAt: at,
			confirmBy: at + DEMO_BILL_RULES.awaitingStaffHours * HOUR_MS,
			counterToken: token,
			state: automatic ? "confirmed" : "awaiting_staff",
			evidenceLevel: 0,
			answered: true,
			firstOutcome: automatic ? "confirmed" : "awaiting_staff",
			disputed: false,
			decidedAt: automatic ? at : null,
			entryId: null,
		};
		bills.push(bill);
		if (!automatic)
			return {
				state: "awaiting_staff",
				refusal: null,
				bill_id: bill.id,
				evidence_level: 0,
				expires_at: new Date(bill.confirmBy).toISOString(),
				replayed: false,
			};
		bill.entryId = billEntry(bill, "confirmed");
		return {
			state: "confirmed",
			refusal: null,
			bill_id: bill.id,
			evidence_level: 0,
			replayed: false,
			stamps_earned: 1,
			points_earned: billPoints(total),
		};
	};

	const memberCode = (store: unknown): Record<string, unknown> => {
		const name = typeof store === "string" ? storeName(store) : null;
		if (name === null) throw new RestError(400, REFUSAL_INVALID);
		const issuedAt = now();
		const window = Math.floor(issuedAt / (MEMBER_CODE_REFRESH_SECONDS * 1000));
		const code = memberCodeOf(DEMO_CUSTOMER_ID, String(store), window);
		return {
			code,
			qr_payload: `fnb-member:1:${String(store)}:${code}`,
			store_code: store,
			store_name: name,
			issued_at: new Date(issuedAt).toISOString(),
			refresh_at: new Date(
				issuedAt + MEMBER_CODE_REFRESH_SECONDS * 1000,
			).toISOString(),
			expires_at: new Date(
				issuedAt + MEMBER_CODE_VALID_SECONDS * 1000,
			).toISOString(),
		};
	};

	const submitClaim = (
		args: Readonly<Record<string, unknown>>,
	): Record<string, unknown> => {
		const store = textField(args, "p_store");
		const receiptNo = (textField(args, "p_receipt_no") ?? "").trim();
		const amount = args.p_amount;
		const businessDate = textField(args, "p_business_date") ?? claimsDay;
		if (
			store === null ||
			storeName(store) === null ||
			!RECEIPT_NO_PATTERN.test(receiptNo) ||
			typeof amount !== "number" ||
			amount <= 0 ||
			!ISO_DATE_PATTERN.test(businessDate)
		)
			throw new RestError(400, REFUSAL_INVALID);
		if (staffStore(store))
			return {
				claim_id: null,
				state: "rejected",
				reason: "staff_mode",
				claims_left_today: Math.max(0, MAX_CLAIMS_PER_DAY - claimsToday()),
			};
		const before = claimsToday();
		const earliest = isoDateIn(
			now() - DEMO_PROGRAMME.receipt_claim_window_hours * 3_600_000,
		);
		const today = isoDateIn(now());
		const leading = (value: string) => value.replace(/^0+/, "");
		const invoice = DEMO_SYNCED_INVOICES.find(
			(candidate) =>
				candidate.store === store &&
				leading(demoReceiptNo(candidate, today)) === leading(receiptNo) &&
				addDays(today, -candidate.daysAgo) === businessDate,
		);
		const reason =
			businessDate > today || businessDate < earliest
				? "outside_window"
				: before >= MAX_CLAIMS_PER_DAY
					? "daily_cap"
					: claims.some(
								(claim) =>
									claim.state !== "rejected" &&
									claim.store === store &&
									leading(claim.receiptNo) === leading(receiptNo) &&
									claim.businessDate === businessDate,
							)
						? "already_claimed"
						: invoice !== undefined && invoice.amount !== amount
							? "amount_mismatch"
							: null;
		claimCount += 1;
		const id = `demo-claim-${claimCount}`;
		const state =
			reason !== null
				? "rejected"
				: invoice === undefined
					? "pending"
					: "matched";
		claims.push({
			id,
			store,
			receiptNo,
			businessDate,
			submittedAt: now(),
			state,
			reason,
		});
		const left = Math.max(0, MAX_CLAIMS_PER_DAY - claimsToday());
		if (reason !== null)
			return { claim_id: id, state, reason, claims_left_today: left };
		if (invoice !== undefined) {
			entry({
				at: now(),
				kind: "earn",
				state: "confirmed",
				stamps: 1,
				points: invoice.points,
				store,
				receiptNo,
				path: "receipt_claim",
			});
		}
		return { claim_id: id, state, reason: null, claims_left_today: left };
	};

	const home = () => ({
		programme:
			settings.programme === "none"
				? null
				: settings.programme === "active"
					? DEMO_PROGRAMME
					: { ...DEMO_PROGRAMME, status: settings.programme },
		oa_id: DEMO_OA_ID,
		legal: settings.privacy
			? DEMO_LEGAL
			: {
					entity_name: DEMO_LEGAL.entity_name,
					policy_version: null,
					documents: DEMO_LEGAL.documents.filter(
						(document) => document.kind !== "privacy_notice",
					),
				},
		stores: settings.stores
			? DEMO_STORES.map((store) =>
					staffStore(store.code)
						? { ...store, confirmation: "staff", counter_claims: true }
						: store,
				)
			: [],
		menu: DEMO_MENU,
	});

	const answer = (
		fn: string,
		args: Readonly<Record<string, unknown>>,
		member: boolean,
	): unknown => {
		const extended = extension?.answer(fn, args);
		if (extended !== undefined) return extended;
		if (fn === CUSTOMER_FUNCTIONS.home) return home();
		if (!member) throw new RestError(403, REFUSAL_NOT_MEMBER);
		switch (fn) {
			case CUSTOMER_FUNCTIONS.wallet:
				return wallet();
			case CUSTOMER_FUNCTIONS.memberCode:
				return memberCode(args.p_store);
			case CUSTOMER_FUNCTIONS.submitClaim:
				return submitClaim(args);
			case CUSTOMER_FUNCTIONS.rewards:
				return rewards(args.p_store);
			case CUSTOMER_FUNCTIONS.redeem:
				return redeem(args);
			case CUSTOMER_FUNCTIONS.vouchers:
				return voucherList();
			case CUSTOMER_FUNCTIONS.stopMarketing:
				marketing = false;
				return {
					marketing_consent: false,
					stopped_at: new Date(now()).toISOString(),
				};
			case CUSTOMER_FUNCTIONS.requestDeletion:
				if (deletion === null || deletion.status === "rejected") {
					deletion = demoDeletion(DEMO_DELETION_REQUEST_ID, "received", now());
				}
				return deletion;
			case CUSTOMER_FUNCTIONS.confirmBill:
				return confirmBill(args);
			case CUSTOMER_FUNCTIONS.disputeBill:
				return disputeBill(args);
			case CUSTOMER_FUNCTIONS.submitCounterClaim:
				return submitCounterClaim(args);
			default:
				throw new RestError(404, "PGRST202");
		}
	};

	const functionFetch: typeof fetch = async (input, init) => {
		await pause();
		if (offline || (strict && browserOffline()))
			throw new TypeError("demo network failure");
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.href
					: input.url;
		const name = /\/functions\/v1\/([a-z0-9-]{1,63})$/.exec(url)?.[1];
		const headers = new Headers(init?.headers);
		const bearer = /^Bearer (.+)$/.exec(headers.get("Authorization") ?? "");
		if (init?.method !== "POST")
			return json({ error: "method_not_allowed", request_id: "demo" }, 405);
		if (bearer === null || !tokens.has(bearer[1] ?? ""))
			return json({ error: "unauthorized", request_id: "demo" }, 401);
		let body: unknown = null;
		try {
			body = typeof init.body === "string" ? JSON.parse(init.body) : null;
		} catch {
			return json({ error: "invalid_request", request_id: "demo" }, 400);
		}
		if (settings.network === "error-once" && !faultSpent) {
			faultSpent = true;
			return json({ error: "internal_error", request_id: "demo" }, 500);
		}
		const reply =
			name === undefined ? undefined : extension?.call?.(name, body);
		if (reply === undefined)
			return json({ error: "not_found", request_id: "demo" }, 404);
		const copy = JSON.parse(JSON.stringify(reply.body));
		if (settings.answerDelayMs > 0)
			await new Promise((resolve) =>
				setTimeout(resolve, settings.answerDelayMs),
			);
		if (strict && browserOffline()) throw new TypeError("demo network failure");
		if (settings.network === "lost-once" && !faultSpent) {
			faultSpent = true;
			throw new TypeError("demo network failure");
		}
		return json(copy, reply.status);
	};

	return {
		settings,
		sessionFetch,
		functionFetch,
		rest(accessToken) {
			const check = (): boolean => {
				if (offline || (strict && browserOffline())) throw new RestError(0);
				const member = tokens.get(accessToken);
				if (member === undefined) throw new RestError(401, UNKNOWN_TOKEN);
				return member && joined;
			};
			return {
				async select() {
					await pause();
					check();
					throw new RestError(404, "PGRST205");
				},
				async rpc(fn, args = {}) {
					await pause();
					const member = check();
					const changes =
						CHANGING_FUNCTIONS.has(fn) ||
						(extension?.changingFunctions.includes(fn) ?? false);
					if (settings.network === "error-once" && changes && !faultSpent) {
						faultSpent = true;
						throw new RestError(500, "XX000");
					}
					const reply = JSON.parse(JSON.stringify(answer(fn, args, member)));
					if (settings.answerDelayMs > 0)
						await new Promise((resolve) =>
							setTimeout(resolve, settings.answerDelayMs),
						);
					if (strict && browserOffline()) throw new RestError(0);
					if (settings.network === "lost-once" && changes && !faultSpent) {
						faultSpent = true;
						throw new RestError(0);
					}
					return reply;
				},
			};
		},
		joined: () => joined,
		extend(next) {
			extension = next;
		},
		now,
		setOffline(value) {
			offline = value;
		},
		marketing: () => marketing,
		deletionRequested: () =>
			deletion !== null && deletion.request_id === DEMO_DELETION_REQUEST_ID,
	};
}
