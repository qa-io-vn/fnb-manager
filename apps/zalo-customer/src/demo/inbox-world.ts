import { RestError } from "@fnb/zalo-mini";
import { REFUSAL_INVALID, REFUSAL_NOT_MEMBER } from "@fnb/zalo-mini/loyalty";
import {
	INBOX_FUNCTIONS,
	INBOX_PAGE_SIZE,
	INBOX_READ_MAX_IDS,
	type InboxKind,
} from "@fnb/zalo-mini/ordering";

// C12's inbox in the demo world (docs/api.md 3.31), answered at the wire level so the app's readers and REST client run
// as in production. The ordering world writes an item where the server's triggers would (an order made ready or
// brought to the table, paid, cancelled by the shop, refunded; stamps added or a card complete) and the till writes a
// campaign offer, only for a member who gave the marketing consent. The customer reads 20 a page newest first,
// filtered by orders or offers, marks items read, and turns "Nhận tin ưu đãi qua Zalo" on with the opt-in sheet.

/** The order an item names, as the ordering world sees it now (null for an order that is not the customer's). */
export interface DemoInboxOrder {
	readonly display_no: string | null;
	readonly type: "table" | "takeaway";
	readonly table_label: string | null;
	readonly status: string;
	readonly payment_status: string;
	readonly total: number;
	readonly pickup_at: string | null;
	readonly cancel_reason: string | null;
	readonly first_item: string | null;
	readonly items: number;
}

export interface DemoInboxConsent {
	/** joined with a phone (only a member can consent) */
	joined(): boolean;
	marketing(): boolean;
	setMarketing(on: boolean): void;
	/** the published privacy notice's version the consent must name */
	readonly policyVersion: string;
}

export interface DemoInboxItem {
	readonly id: string;
	readonly seq: number;
	readonly kind: InboxKind;
	readonly key: string;
	readonly createdAt: string;
	readAt: string | null;
	readonly orderId: string | null;
	readonly params: Readonly<Record<string, string | number>>;
	readonly title: string | null;
	readonly line: string | null;
}

export interface DemoInbox {
	/** writes an item once per key, as the server's triggers do; answers whether it was new */
	add(item: {
		readonly kind: InboxKind;
		readonly key: string;
		readonly orderId?: string | null;
		readonly params?: Readonly<Record<string, string | number | null>>;
		readonly title?: string;
		readonly line?: string;
	}): boolean;
	/** a campaign's item (GA-066), written only with the marketing consent */
	offer(title: string, line: string): boolean;
	/** the answer of one of the inbox functions, or undefined for any other */
	answer(fn: string, args: Readonly<Record<string, unknown>>): unknown;
	readonly changingFunctions: readonly string[];
	/** the items as the customer's copy of their data names them (C19) */
	exportSection(): readonly unknown[];
	/** the account was deleted: the items go with the login */
	clear(): void;
	/** for tests: the items, newest first */
	items(): readonly DemoInboxItem[];
}

const ORDER_KINDS: readonly InboxKind[] = [
	"order_ready",
	"order_receipt",
	"order_cancelled",
	"order_refunded",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VERSION = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const topicOf = (kind: InboxKind) =>
	ORDER_KINDS.includes(kind) ? "orders" : "offers";
const targetOf = (kind: InboxKind) =>
	ORDER_KINDS.includes(kind)
		? "order"
		: kind === "stamp" || kind === "reward"
			? "stamps"
			: "offers";

export function createInboxWorld(
	now: () => number,
	consent: DemoInboxConsent,
	orderOf: (id: string) => DemoInboxOrder | null,
	rewardName: string,
): DemoInbox {
	const items: DemoInboxItem[] = [];
	let seq = 0;
	const iso = () => new Date(now()).toISOString();
	const shown = () =>
		items.filter((item) => Date.parse(item.createdAt) > now() - RETENTION_MS);
	const unread = (topic?: string) =>
		shown().filter(
			(item) =>
				item.readAt === null &&
				(topic === undefined || topicOf(item.kind) === topic),
		).length;

	const add: DemoInbox["add"] = (item) => {
		if (items.some((known) => known.key === item.key)) return false;
		seq += 1;
		const params: Record<string, string | number> = {};
		for (const [name, value] of Object.entries(item.params ?? {}))
			if (value !== null) params[name] = value;
		items.push({
			id: `cccccccc-0000-4000-8000-${String(seq).padStart(12, "0")}`,
			seq,
			kind: item.kind,
			key: item.key,
			createdAt: iso(),
			readAt: null,
			orderId: item.orderId ?? null,
			params,
			title: item.title ?? null,
			line: item.line ?? null,
		});
		return true;
	};

	const itemJson = (item: DemoInboxItem) => ({
		id: item.id,
		cursor: item.seq,
		kind: item.kind,
		topic: topicOf(item.kind),
		created_at: item.createdAt,
		read_at: item.readAt,
		target: targetOf(item.kind),
		order_id: item.orderId,
		order: item.orderId === null ? null : orderOf(item.orderId),
		reward_name:
			item.kind === "stamp" || item.kind === "reward" ? rewardName : null,
		params: item.params,
		title: item.title,
		line: item.line,
	});

	const page = (args: Readonly<Record<string, unknown>>) => {
		const filter = args.p_filter ?? "all";
		const before = args.p_before ?? null;
		if (filter !== "all" && filter !== "orders" && filter !== "offers")
			throw new RestError(400, REFUSAL_INVALID);
		if (
			before !== null &&
			(typeof before !== "number" ||
				!Number.isSafeInteger(before) ||
				before < 1)
		)
			throw new RestError(400, REFUSAL_INVALID);
		const matching = shown()
			.filter(
				(item) =>
					(filter === "all" || topicOf(item.kind) === filter) &&
					(before === null || item.seq < before),
			)
			.sort((a, b) => b.seq - a.seq);
		const pageItems = matching.slice(0, INBOX_PAGE_SIZE);
		return {
			filter,
			items: pageItems.map(itemJson),
			next_before:
				matching.length > INBOX_PAGE_SIZE
					? (pageItems[pageItems.length - 1]?.seq ?? null)
					: null,
			unread: unread(),
			unread_by_topic: { orders: unread("orders"), offers: unread("offers") },
			marketing: {
				member: consent.joined(),
				consent: consent.joined() && consent.marketing(),
				weekly_cap: 2,
			},
		};
	};

	const markRead = (ids: unknown) => {
		if (
			ids !== null &&
			(!Array.isArray(ids) ||
				ids.length < 1 ||
				ids.length > INBOX_READ_MAX_IDS ||
				ids.some((id) => typeof id !== "string" || !UUID.test(id)))
		)
			throw new RestError(400, REFUSAL_INVALID);
		const at = iso();
		let marked = 0;
		for (const item of shown())
			if (
				item.readAt === null &&
				(ids === null || (ids as string[]).includes(item.id))
			) {
				item.readAt = at;
				marked += 1;
			}
		return { state: "read", refusal: null, marked, unread: unread() };
	};

	const startMarketing = (args: Readonly<Record<string, unknown>>) => {
		const policy = args.p_policy_version;
		const screen = args.p_screen_version;
		const shownAt = args.p_shown_at;
		if (
			typeof policy !== "string" ||
			!VERSION.test(policy) ||
			typeof screen !== "string" ||
			!VERSION.test(screen) ||
			typeof shownAt !== "string" ||
			Number.isNaN(Date.parse(shownAt)) ||
			Date.parse(shownAt) > now() + 5 * 60_000
		)
			throw new RestError(400, REFUSAL_INVALID);
		// the server's 42501 for a visitor: only a member can consent
		if (!consent.joined()) throw new RestError(403, REFUSAL_NOT_MEMBER);
		if (policy !== consent.policyVersion)
			return {
				state: "refused",
				refusal: "policy_outdated",
				marketing_consent: consent.marketing(),
			};
		const replayed = consent.marketing();
		consent.setMarketing(true);
		return {
			state: "started",
			refusal: null,
			marketing_consent: true,
			started_at: iso(),
			replayed,
		};
	};

	return {
		add,
		offer(title, line) {
			if (!consent.joined() || !consent.marketing()) return false;
			return add({
				kind: "offer",
				key: `offer:${seq + 1}`,
				params: { offer: "campaign" },
				title,
				line,
			});
		},
		answer(fn, args) {
			switch (fn) {
				case INBOX_FUNCTIONS.inbox:
					return page(args);
				case INBOX_FUNCTIONS.unread:
					return { unread: unread() };
				case INBOX_FUNCTIONS.read:
					return markRead(args.p_ids ?? null);
				case INBOX_FUNCTIONS.startMarketing:
					return startMarketing(args);
				default:
					return undefined;
			}
		},
		changingFunctions: [INBOX_FUNCTIONS.read, INBOX_FUNCTIONS.startMarketing],
		exportSection: () =>
			[...items]
				.sort((a, b) => a.seq - b.seq)
				.map((item) => ({
					kind: item.kind,
					created_at: item.createdAt,
					read_at: item.readAt,
					params: item.params,
					title: item.title,
					line: item.line,
					order_no:
						item.orderId === null
							? null
							: (orderOf(item.orderId)?.display_no ?? null),
				})),
		clear() {
			items.length = 0;
		},
		items: () => [...items].sort((a, b) => b.seq - a.seq),
	};
}
