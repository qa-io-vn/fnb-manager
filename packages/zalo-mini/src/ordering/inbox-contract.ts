// The wire contract of C12 "Thông báo" (docs/api.md 3.31, ADR-073): the customer's own inbox, its unread count, the
// read marks and "Nhận tin ưu đãi qua Zalo" (the marketing consent; stopping is the loyalty contract's
// customer_stop_marketing). Snake case is the wire; the readers return camel case and refuse anything malformed. An item
// holds count-only facts and, for a campaign, its title and line: no phone, name or address ever.

export const INBOX_FUNCTIONS = {
	inbox: "customer_inbox",
	unread: "customer_inbox_unread",
	read: "customer_inbox_read",
	startMarketing: "customer_start_marketing",
} as const;

/** 20 items a page, newest first. */
export const INBOX_PAGE_SIZE = 20;
/** The most ids one read mark names. */
export const INBOX_READ_MAX_IDS = 100;
/** The version of the opt-in sheet's text the consent records ("Nhận tin ưu đãi qua Zalo? Em gửi tối đa 2 tin…"). */
export const INBOX_OPT_IN_SCREEN_VERSION = "inbox-optin-1";
/** What the opt-in text promises when the server does not say: at most 2 promotions a week. */
export const MARKETING_WEEKLY_CAP = 2;

export const INBOX_FILTERS = ["all", "orders", "offers"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_KINDS = [
	"order_ready",
	"order_receipt",
	"order_cancelled",
	"order_refunded",
	"stamp",
	"reward",
	"offer",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/** Where tapping an item leads: the order (C06), the stamp card (C07) or the offers. */
export const INBOX_TARGETS = ["order", "stamps", "offers"] as const;
export type InboxTarget = (typeof INBOX_TARGETS)[number];

/** The order an item is about, as it is now. */
export interface InboxOrder {
	/** "#007", null for an order cancelled before it had a number */
	readonly displayNo: string | null;
	readonly type: "table" | "takeaway";
	readonly tableLabel: string | null;
	readonly status: string;
	readonly paymentStatus: string;
	readonly total: number;
	readonly pickupAt: string | null;
	readonly cancelReason: string | null;
	/** the name of the order's first line */
	readonly firstItem: string | null;
	/** how many items the order holds */
	readonly items: number;
}

/** The count-only facts of the event; each only for the kinds that carry it. */
export interface InboxParams {
	readonly orderType: "table" | "takeaway" | null;
	readonly amount: number | null;
	readonly method: string | null;
	readonly reason: string | null;
	readonly refundDue: number | null;
	readonly refundedOn: string | null;
	readonly by: string | null;
	readonly added: number | null;
	readonly stamps: number | null;
	readonly left: number | null;
	readonly per: number | null;
	readonly rewards: number | null;
	readonly offer: string | null;
	readonly inactiveDays: number | null;
}

export interface InboxItem {
	readonly id: string;
	readonly cursor: number;
	readonly kind: InboxKind;
	readonly topic: "orders" | "offers";
	readonly createdAt: string;
	readonly readAt: string | null;
	readonly target: InboxTarget;
	readonly orderId: string | null;
	readonly order: InboxOrder | null;
	/** the brand's reward of the stamp card, for stamp and reward items */
	readonly rewardName: string | null;
	readonly params: InboxParams;
	/** a campaign's title and line (offer items) */
	readonly title: string | null;
	readonly line: string | null;
}

export interface InboxMarketing {
	/** joined with a phone: only a member can give the consent */
	readonly member: boolean;
	readonly consent: boolean;
	readonly weeklyCap: number;
}

export interface InboxPage {
	readonly filter: InboxFilter;
	readonly items: readonly InboxItem[];
	/** the cursor of the next page, null on the last */
	readonly nextBefore: number | null;
	readonly unread: number;
	readonly unreadByTopic: { readonly orders: number; readonly offers: number };
	readonly marketing: InboxMarketing;
}

export type InboxReadAnswer =
	| {
			readonly state: "read";
			readonly marked: number;
			readonly unread: number;
	  }
	| {
			readonly state: "refused";
			/** rate_limited, or another the app words generally */
			readonly refusal: string;
			readonly retryAt: string | null;
	  };

export type StartMarketingAnswer =
	| {
			readonly state: "started";
			readonly startedAt: string;
			readonly replayed: boolean;
	  }
	| {
			readonly state: "refused";
			/** policy_outdated, rate_limited, or another the app words generally */
			readonly refusal: string;
			readonly retryAt: string | null;
			readonly marketingConsent: boolean;
	  };

type Row = Readonly<Record<string, unknown>>;

const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_PATTERN = /^[a-z0-9][a-z0-9.-]{0,39}$/;

function invalid(what: string): never {
	throw new Error(`the inbox answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Row)
		: invalid(what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function optionalInstant(value: unknown, what: string): string | null {
	return value === null || value === undefined ? null : instant(value, what);
}

function count(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: invalid(what);
}

function optionalCount(value: unknown, what: string): number | null {
	return value === null || value === undefined ? null : count(value, what);
}

function optionalCode(value: unknown, what: string): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && CODE_PATTERN.test(value)
		? value
		: invalid(what);
}

function optionalText(
	value: unknown,
	what: string,
	max: number,
): string | null {
	if (value === null || value === undefined) return null;
	return typeof value === "string" && [...value].length <= max
		? value
		: invalid(what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

function readOrder(value: unknown): InboxOrder | null {
	if (value === null || value === undefined) return null;
	const row = record(value, "order");
	return {
		displayNo: optionalText(row.display_no, "order number", 10),
		type: oneOf(["table", "takeaway"] as const, row.type, "order type"),
		tableLabel: optionalText(row.table_label, "table", 40),
		status: optionalCode(row.status, "order status") ?? invalid("order status"),
		paymentStatus:
			optionalCode(row.payment_status, "payment status") ??
			invalid("payment status"),
		total: count(row.total, "order total"),
		pickupAt: optionalInstant(row.pickup_at, "pick-up time"),
		cancelReason: optionalCode(row.cancel_reason, "cancel reason"),
		firstItem: optionalText(row.first_item, "first item", 200),
		items: count(row.items, "item count"),
	};
}

function readParams(value: unknown): InboxParams {
	const row = record(value ?? {}, "parameters");
	const refundedOn = row.refunded_on;
	return {
		orderType:
			row.order_type === null || row.order_type === undefined
				? null
				: oneOf(["table", "takeaway"] as const, row.order_type, "order type"),
		amount: optionalCount(row.amount, "amount"),
		method: optionalCode(row.method, "method"),
		reason: optionalCode(row.reason, "reason"),
		refundDue: optionalCount(row.refund_due, "refund due"),
		refundedOn:
			refundedOn === null || refundedOn === undefined
				? null
				: typeof refundedOn === "string" && DATE_PATTERN.test(refundedOn)
					? refundedOn
					: invalid("refund day"),
		by: optionalCode(row.by, "actor"),
		added: optionalCount(row.added, "stamps added"),
		stamps: optionalCount(row.stamps, "stamps"),
		left: optionalCount(row.left, "stamps left"),
		per: optionalCount(row.per, "stamps per reward"),
		rewards: optionalCount(row.rewards, "rewards"),
		offer: optionalCode(row.offer, "offer"),
		inactiveDays: optionalCount(row.inactive_days, "inactive days"),
	};
}

export function readInboxItem(value: unknown): InboxItem {
	const row = record(value, "item");
	const kind = oneOf(INBOX_KINDS, row.kind, "kind");
	const topic = oneOf(["orders", "offers"] as const, row.topic, "topic");
	const orderKind = kind.startsWith("order_");
	if ((topic === "orders") !== orderKind) invalid("topic of the kind");
	const orderId =
		row.order_id === null || row.order_id === undefined
			? null
			: typeof row.order_id === "string" && UUID_PATTERN.test(row.order_id)
				? row.order_id
				: invalid("order id");
	if (orderKind && orderId === null) invalid("order of an order item");
	return {
		id:
			typeof row.id === "string" && UUID_PATTERN.test(row.id)
				? row.id
				: invalid("id"),
		cursor:
			typeof row.cursor === "number" &&
			Number.isSafeInteger(row.cursor) &&
			row.cursor > 0
				? row.cursor
				: invalid("cursor"),
		kind,
		topic,
		createdAt: instant(row.created_at, "time"),
		readAt: optionalInstant(row.read_at, "read time"),
		target: oneOf(INBOX_TARGETS, row.target, "target"),
		orderId,
		order: readOrder(row.order),
		rewardName: optionalText(row.reward_name, "reward name", 60),
		params: readParams(row.params),
		title: optionalText(row.title, "title", 80),
		line: optionalText(row.line, "line", 160),
	};
}

export function readInboxPage(value: unknown): InboxPage {
	const row = record(value, "page");
	const items = Array.isArray(row.items) ? row.items : invalid("items");
	if (items.length > INBOX_PAGE_SIZE) invalid("page size");
	const read = items.map(readInboxItem);
	for (let index = 1; index < read.length; index += 1)
		if ((read[index]?.cursor ?? 0) >= (read[index - 1]?.cursor ?? 0))
			invalid("order of the items");
	const byTopic = record(row.unread_by_topic, "unread per filter");
	const marketing = record(row.marketing, "marketing");
	return {
		filter: oneOf(INBOX_FILTERS, row.filter, "filter"),
		items: read,
		nextBefore:
			row.next_before === null || row.next_before === undefined
				? null
				: typeof row.next_before === "number" &&
						Number.isSafeInteger(row.next_before) &&
						row.next_before > 0
					? row.next_before
					: invalid("next page"),
		unread: count(row.unread, "unread"),
		unreadByTopic: {
			orders: count(byTopic.orders, "unread orders"),
			offers: count(byTopic.offers, "unread offers"),
		},
		marketing: {
			member: marketing.member === true,
			consent: marketing.consent === true,
			weeklyCap:
				optionalCount(marketing.weekly_cap, "weekly cap") ??
				MARKETING_WEEKLY_CAP,
		},
	};
}

export function readInboxUnread(value: unknown): { readonly unread: number } {
	return { unread: count(record(value, "unread").unread, "unread") };
}

export function readInboxReadAnswer(value: unknown): InboxReadAnswer {
	const row = record(value, "read answer");
	if (row.state === "read")
		return {
			state: "read",
			marked: count(row.marked, "marked"),
			unread: count(row.unread, "unread"),
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: optionalCode(row.refusal, "refusal") ?? invalid("refusal"),
			retryAt: optionalInstant(row.retry_at, "retry time"),
		};
	return invalid("read state");
}

export function readStartMarketingAnswer(value: unknown): StartMarketingAnswer {
	const row = record(value, "marketing answer");
	if (row.state === "started" && row.marketing_consent === true)
		return {
			state: "started",
			startedAt: instant(row.started_at, "start time"),
			replayed: row.replayed === true,
		};
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: optionalCode(row.refusal, "refusal") ?? invalid("refusal"),
			retryAt: optionalInstant(row.retry_at, "retry time"),
			marketingConsent: row.marketing_consent === true,
		};
	return invalid("marketing state");
}

/** The page's arguments: a filter and the cursor of the page after the last one read (null: the newest). */
export function inboxArgs(
	filter: InboxFilter,
	before: number | null,
): Readonly<Record<string, unknown>> {
	if (!(INBOX_FILTERS as readonly string[]).includes(filter))
		throw new Error("the inbox filter is all, orders or offers");
	if (before !== null && (!Number.isSafeInteger(before) || before < 1))
		throw new Error("an inbox cursor is a positive whole number");
	return { p_filter: filter, p_before: before };
}

/** The read mark's arguments: 1 to 100 item ids, or null for every unread item. */
export function inboxReadArgs(
	ids: readonly string[] | null,
): Readonly<Record<string, unknown>> {
	if (ids === null) return { p_ids: null };
	if (
		ids.length < 1 ||
		ids.length > INBOX_READ_MAX_IDS ||
		ids.some((id) => !UUID_PATTERN.test(id))
	)
		throw new Error("mark 1 to 100 items read by their ids, or every one");
	return { p_ids: [...ids] };
}

/** The consent's arguments: the privacy notice's version, the opt-in text's version and when the sheet was shown. */
export function startMarketingArgs(
	policyVersion: string,
	shownAt: string,
	screenVersion: string = INBOX_OPT_IN_SCREEN_VERSION,
): Readonly<Record<string, unknown>> {
	if (
		!VERSION_PATTERN.test(policyVersion) ||
		!VERSION_PATTERN.test(screenVersion)
	)
		throw new Error(
			"the policy and screen versions are 1 to 40 of a-z, 0-9, . and -",
		);
	if (Number.isNaN(Date.parse(shownAt)))
		throw new Error("the time the sheet was shown is an ISO instant");
	return {
		p_policy_version: policyVersion,
		p_screen_version: screenVersion,
		p_shown_at: shownAt,
	};
}
