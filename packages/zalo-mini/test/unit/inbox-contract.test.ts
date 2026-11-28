import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	INBOX_FUNCTIONS,
	INBOX_OPT_IN_SCREEN_VERSION,
	inboxArgs,
	inboxReadArgs,
	readInboxItem,
	readInboxPage,
	readInboxReadAnswer,
	readInboxUnread,
	readStartMarketingAnswer,
	startMarketingArgs,
} from "../../src/ordering/inbox-contract";
import { createRestOrderingClient } from "../../src/ordering/rest-ordering-client";

// Test design (ISTQB) for C12's wire contract (docs/api.md 3.31, ADR-073):
// - equivalence partitions of an item per kind (an order item with its order, a stamp item with the reward's name, a
//   campaign offer with its text), of a page (one page, a page with a next one, the last), of the read mark (read,
//   refused) and of the consent (started, a replay, refused);
// - boundary values: 20 items accepted and 21 refused; the cursor 1 accepted, 0 refused; 1 and 100 ids accepted, 0
//   and 101 refused; a title of 80 characters accepted and 81 refused;
// - error guessing on the reader: an order kind without its order id, a topic that is not the kind's, items out of
//   order, an unknown kind, a malformed refund day, a phone-shaped extra key never read;
// - the REST client's calls carry the function and parameter names the SQL declares.

const ORDER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ITEM = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";

const orderItem = (
	cursor: number,
	overrides: Record<string, unknown> = {},
) => ({
	id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(cursor).padStart(12, "0")}`,
	cursor,
	kind: "order_ready",
	topic: "orders",
	created_at: "2026-11-27T05:00:00Z",
	read_at: null,
	target: "order",
	order_id: ORDER,
	order: {
		display_no: "#007",
		type: "table",
		table_label: "Bàn 5",
		status: "serving",
		payment_status: "paid",
		total: 120000,
		pickup_at: null,
		cancel_reason: null,
		first_item: "Cà phê sữa",
		items: 3,
	},
	reward_name: null,
	params: { order_type: "table" },
	title: null,
	line: null,
	...overrides,
});

const page = (items: unknown[], overrides: Record<string, unknown> = {}) => ({
	filter: "all",
	items,
	next_before: null,
	unread: 1,
	unread_by_topic: { orders: 1, offers: 0 },
	marketing: { member: true, consent: false, weekly_cap: 2 },
	...overrides,
});

describe("an inbox item", () => {
	it("reads an order item with the order as it is now", () => {
		const item = readInboxItem(orderItem(7));
		expect(item).toMatchObject({
			cursor: 7,
			kind: "order_ready",
			topic: "orders",
			target: "order",
			orderId: ORDER,
			readAt: null,
			order: {
				displayNo: "#007",
				type: "table",
				tableLabel: "Bàn 5",
				firstItem: "Cà phê sữa",
				items: 3,
				total: 120000,
			},
			params: { orderType: "table", amount: null },
		});
	});

	it("reads a stamp item with the reward's name and a refund with its day", () => {
		expect(
			readInboxItem(
				orderItem(2, {
					kind: "stamp",
					topic: "offers",
					target: "stamps",
					order_id: null,
					order: null,
					reward_name: "Ly miễn phí",
					params: { added: 1, stamps: 3, left: 6, per: 9 },
				}),
			),
		).toMatchObject({
			kind: "stamp",
			rewardName: "Ly miễn phí",
			params: { added: 1, left: 6, per: 9 },
		});
		expect(
			readInboxItem(
				orderItem(3, {
					kind: "order_refunded",
					params: {
						amount: 40000,
						method: "vietqr",
						refunded_on: "2026-11-28",
					},
				}),
			).params,
		).toMatchObject({
			amount: 40000,
			method: "vietqr",
			refundedOn: "2026-11-28",
		});
	});

	it("reads a campaign's title and line, 80 and 160 characters at most", () => {
		const offer = (title: string) =>
			orderItem(4, {
				kind: "offer",
				topic: "offers",
				target: "offers",
				order_id: null,
				order: null,
				params: { offer: "campaign" },
				title,
				line: "Giảm giá cho khách ghé trước 10 giờ",
			});
		expect(readInboxItem(offer("Ư".repeat(80))).title).toHaveLength(80);
		expect(() => readInboxItem(offer("Ư".repeat(81)))).toThrow();
	});

	it("refuses an order kind without its order, a topic that is not its kind's, an unknown kind and a bad day", () => {
		expect(() => readInboxItem(orderItem(1, { order_id: null }))).toThrow();
		expect(() => readInboxItem(orderItem(1, { topic: "offers" }))).toThrow();
		expect(() => readInboxItem(orderItem(1, { kind: "event" }))).toThrow();
		expect(() =>
			readInboxItem(orderItem(1, { params: { refunded_on: "28/11/2026" } })),
		).toThrow();
		expect(() => readInboxItem(orderItem(0))).toThrow();
	});

	it("never reads a key the contract does not name", () => {
		const item = readInboxItem(
			orderItem(1, { params: { order_type: "table", phone: "x" } }),
		);
		expect(JSON.stringify(item)).not.toContain("phone");
	});
});

describe("a page", () => {
	it("reads 20 items with the next page's cursor and refuses 21", () => {
		const twenty = Array.from({ length: 20 }, (_, index) =>
			orderItem(40 - index),
		);
		const read = readInboxPage(page(twenty, { next_before: 21 }));
		expect(read.items).toHaveLength(20);
		expect(read.nextBefore).toBe(21);
		expect(() =>
			readInboxPage(page([...twenty, orderItem(1)], { next_before: 2 })),
		).toThrow();
	});

	it("reads the last page, the unread counts and the switch", () => {
		expect(readInboxPage(page([orderItem(1)]))).toMatchObject({
			filter: "all",
			nextBefore: null,
			unread: 1,
			unreadByTopic: { orders: 1, offers: 0 },
			marketing: { member: true, consent: false, weeklyCap: 2 },
		});
	});

	it("refuses items out of order and an unknown filter", () => {
		expect(() => readInboxPage(page([orderItem(1), orderItem(2)]))).toThrow();
		expect(() => readInboxPage(page([], { filter: "events" }))).toThrow();
	});

	it("reads the bell's count", () => {
		expect(readInboxUnread({ unread: 3 })).toEqual({ unread: 3 });
		expect(() => readInboxUnread({ unread: -1 })).toThrow();
	});
});

describe("the writes' answers", () => {
	it("reads a read mark and its refusal", () => {
		expect(
			readInboxReadAnswer({
				state: "read",
				refusal: null,
				marked: 1,
				unread: 0,
			}),
		).toEqual({
			state: "read",
			marked: 1,
			unread: 0,
		});
		expect(
			readInboxReadAnswer({
				state: "refused",
				refusal: "rate_limited",
				retry_at: "2026-11-27T05:15:00Z",
				marked: 0,
			}),
		).toEqual({
			state: "refused",
			refusal: "rate_limited",
			retryAt: "2026-11-27T05:15:00Z",
		});
	});

	it("reads the consent: started, a replay and a refusal", () => {
		expect(
			readStartMarketingAnswer({
				state: "started",
				refusal: null,
				marketing_consent: true,
				started_at: "2026-11-27T05:00:00Z",
				replayed: true,
			}),
		).toEqual({
			state: "started",
			startedAt: "2026-11-27T05:00:00Z",
			replayed: true,
		});
		expect(
			readStartMarketingAnswer({
				state: "refused",
				refusal: "policy_outdated",
				marketing_consent: false,
			}),
		).toEqual({
			state: "refused",
			refusal: "policy_outdated",
			retryAt: null,
			marketingConsent: false,
		});
		expect(() =>
			readStartMarketingAnswer({ state: "started", marketing_consent: false }),
		).toThrow();
	});
});

describe("the arguments", () => {
	it("bound the filter and the cursor", () => {
		expect(inboxArgs("offers", 1)).toEqual({ p_filter: "offers", p_before: 1 });
		expect(inboxArgs("all", null)).toEqual({ p_filter: "all", p_before: null });
		expect(() => inboxArgs("all", 0)).toThrow();
		expect(() => inboxArgs("events" as never, null)).toThrow();
	});

	it("bound the ids of a read mark at 1 and 100", () => {
		const ids = (n: number) =>
			Array.from(
				{ length: n },
				(_, index) =>
					`bbbbbbbb-bbbb-4bbb-8bbb-${String(index + 1).padStart(12, "0")}`,
			);
		expect(inboxReadArgs(null)).toEqual({ p_ids: null });
		expect(inboxReadArgs(ids(1))).toEqual({ p_ids: ids(1) });
		expect((inboxReadArgs(ids(100)).p_ids as string[]).length).toBe(100);
		expect(() => inboxReadArgs([])).toThrow();
		expect(() => inboxReadArgs(ids(101))).toThrow();
		expect(() => inboxReadArgs(["not-an-id"])).toThrow();
	});

	it("carry the opt-in text's version with the notice's", () => {
		expect(startMarketingArgs("privacy-1", "2026-11-27T05:00:00Z")).toEqual({
			p_policy_version: "privacy-1",
			p_screen_version: INBOX_OPT_IN_SCREEN_VERSION,
			p_shown_at: "2026-11-27T05:00:00Z",
		});
		expect(() =>
			startMarketingArgs("Privacy 1", "2026-11-27T05:00:00Z"),
		).toThrow();
		expect(() => startMarketingArgs("privacy-1", "yesterday")).toThrow();
	});
});

describe("the REST client's inbox calls", () => {
	function recording(answer: unknown) {
		const calls: { fn: string; args: unknown }[] = [];
		const rest: RestClient = {
			select: async () => [],
			rpc: async (fn, args) => {
				calls.push({ fn, args });
				return answer;
			},
		};
		return { calls, client: createRestOrderingClient(rest) };
	}

	it("call the functions and parameter names the SQL declares", async () => {
		const list = recording(page([]));
		await list.client.inbox("orders", 12);
		expect(list.calls[0]).toEqual({
			fn: "customer_inbox",
			args: { p_filter: "orders", p_before: 12 },
		});
		const unread = recording({ unread: 0 });
		await unread.client.inboxUnread();
		expect(unread.calls[0]?.fn).toBe(INBOX_FUNCTIONS.unread);
		const read = recording({ state: "read", marked: 1, unread: 0 });
		await read.client.markInboxRead([ITEM]);
		expect(read.calls[0]).toEqual({
			fn: "customer_inbox_read",
			args: { p_ids: [ITEM] },
		});
		const start = recording({
			state: "started",
			marketing_consent: true,
			started_at: "2026-11-27T05:00:00Z",
			replayed: false,
		});
		await start.client.startMarketing("privacy-1", "2026-11-27T05:00:00Z");
		expect(start.calls[0]).toEqual({
			fn: "customer_start_marketing",
			args: {
				p_policy_version: "privacy-1",
				p_screen_version: "inbox-optin-1",
				p_shown_at: "2026-11-27T05:00:00Z",
			},
		});
	});
});
