import { type RestClient, RestError } from "@fnb/zalo-mini";
import {
	CUSTOMER_FUNCTIONS,
	CUSTOMER_SESSION_KIND,
	ISO_DATE_PATTERN,
	MAX_CLAIMS_PER_DAY,
	MEMBER_CODE_REFRESH_SECONDS,
	MEMBER_CODE_VALID_SECONDS,
	RECEIPT_NO_PATTERN,
	REFUSAL_INVALID,
	REFUSAL_NOT_MEMBER,
} from "@fnb/zalo-mini/loyalty";
import { addDays, isoDateIn } from "../data/dates";
import {
	DEMO_CUSTOMER_ID,
	DEMO_DISPLAY_NAME,
	DEMO_LEGAL,
	DEMO_MEMBERSHIP_ID,
	DEMO_MENU,
	DEMO_OA_ID,
	DEMO_PHONE_MASKED,
	DEMO_PHONE_TOKEN,
	DEMO_PROGRAMME,
	DEMO_STAMPS_PER_CARD,
	DEMO_STORES,
	DEMO_SYNCED_INVOICES,
	DEMO_TENANT_ID,
	DEMO_WELCOME_STAMPS,
} from "./fixtures";

export interface DemoSettings {
	readonly member: boolean;
	readonly marketing: boolean;
	readonly sessionFailure: boolean;
	readonly claimsUsed: number;
	readonly delayMs: number;
}

export const DEMO_DEFAULTS: DemoSettings = {
	member: false,
	marketing: false,
	sessionFailure: false,
	claimsUsed: 0,
	delayMs: 0,
};

const MAX_DEMO_DELAY_MS = 10_000;
const SESSION_SECONDS = 3600;
const UNKNOWN_TOKEN = "PGRST301";

export function demoSettingsFrom(search: string): DemoSettings {
	const params = new URLSearchParams(search);
	const delay = Number(params.get("dataDelay") ?? "0");
	const claims = Number(params.get("claims") ?? "0");
	const member = params.get("member") === "1";
	return {
		member,
		marketing: member && params.get("marketing") === "1",
		sessionFailure: params.get("session") === "failed",
		claimsUsed:
			Number.isInteger(claims) && claims > 0
				? Math.min(claims, MAX_CLAIMS_PER_DAY)
				: 0,
		delayMs:
			Number.isInteger(delay) && delay > 0
				? Math.min(delay, MAX_DEMO_DELAY_MS)
				: 0,
	};
}

interface Entry {
	id: string;
	at: number;
	kind: "welcome" | "earn" | "reversal";
	state: "pending" | "confirmed" | "reversed";
	stamps: number;
	points: number;
	store: string | null;
	receiptNo: string | null;
	path: "welcome" | "phone" | "member_code" | "receipt_claim" | null;
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

export interface DemoWorld {
	readonly settings: DemoSettings;
	readonly sessionFetch: typeof fetch;
	rest(accessToken: string): RestClient;
	joined(): boolean;
	marketing(): boolean;
	setOffline(offline: boolean): void;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

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
	let deletionCount = 0;
	let offline = false;
	const entries: Entry[] = [];
	const claims: Claim[] = [];
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
		if (textField(join, "policy_version") !== DEMO_LEGAL.policy_version)
			return json({ error: "policy_outdated" }, 409);
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

	const sessionFetch: typeof fetch = async (_input, init) => {
		await pause();
		if (settings.sessionFailure) throw new TypeError("demo network failure");
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

	const claimsToday = (): number =>
		extraClaimsToday +
		claims.filter((claim) => isoDateIn(claim.submittedAt) === isoDateIn(now()))
			.length;

	const wallet = (): Record<string, unknown> => {
		const stamps = entries
			.filter(confirmed)
			.reduce((sum, value) => sum + value.stamps, 0);
		const pendingStamps = entries
			.filter((value) => value.state === "pending")
			.reduce((sum, value) => sum + value.stamps, 0);
		const points = entries
			.filter(confirmed)
			.reduce((sum, value) => sum + value.points, 0);
		const pendingPoints = entries
			.filter((value) => value.state === "pending")
			.reduce((sum, value) => sum + value.points, 0);
		const tiers = DEMO_PROGRAMME.tiers;
		const tierIndex = tiers.reduce(
			(found, tier, index) => (points >= tier.min_points ? index : found),
			0,
		);
		const tier = tiers[tierIndex] ?? tiers[0];
		const next = tiers[tierIndex + 1] ?? null;
		const firstEarn = entries.find(
			(value) => confirmed(value) && value.points > 0,
		);
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
					expires_on: addDays(memberSince, 180),
				},
			],
			points: {
				balance: points,
				pending: pendingPoints,
				expiring:
					firstEarn === undefined
						? null
						: {
								points: firstEarn.points,
								on: addDays(isoDateIn(firstEarn.at), 365),
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
					reason: value.kind === "welcome" ? "welcome" : null,
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
		const before = claimsToday();
		const earliest = isoDateIn(
			now() - DEMO_PROGRAMME.receipt_claim_window_hours * 3_600_000,
		);
		const today = isoDateIn(now());
		const leading = (value: string) => value.replace(/^0+/, "");
		const invoice = DEMO_SYNCED_INVOICES.find(
			(candidate) =>
				candidate.store === store &&
				leading(candidate.receiptNo) === leading(receiptNo) &&
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
		programme: DEMO_PROGRAMME,
		oa_id: DEMO_OA_ID,
		legal: DEMO_LEGAL,
		stores: DEMO_STORES,
		menu: DEMO_MENU,
	});

	const answer = (
		fn: string,
		args: Readonly<Record<string, unknown>>,
		member: boolean,
	): unknown => {
		if (fn === CUSTOMER_FUNCTIONS.home) return home();
		if (!member) throw new RestError(403, REFUSAL_NOT_MEMBER);
		switch (fn) {
			case CUSTOMER_FUNCTIONS.wallet:
				return wallet();
			case CUSTOMER_FUNCTIONS.memberCode:
				return memberCode(args.p_store);
			case CUSTOMER_FUNCTIONS.submitClaim:
				return submitClaim(args);
			case CUSTOMER_FUNCTIONS.stopMarketing:
				marketing = false;
				return {
					marketing_consent: false,
					stopped_at: new Date(now()).toISOString(),
				};
			case CUSTOMER_FUNCTIONS.requestDeletion:
				deletionCount += 1;
				return {
					request_id: `demo-deletion-${deletionCount}`,
					status: "received",
					requested_at: new Date(now()).toISOString(),
				};
			default:
				throw new RestError(404, "PGRST202");
		}
	};

	return {
		settings,
		sessionFetch,
		rest(accessToken) {
			const check = (): boolean => {
				if (offline) throw new RestError(0);
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
					return JSON.parse(JSON.stringify(answer(fn, args, member)));
				},
			};
		},
		joined: () => joined,
		setOffline(value) {
			offline = value;
		},
		marketing: () => marketing,
	};
}
