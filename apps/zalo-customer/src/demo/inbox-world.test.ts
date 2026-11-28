import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
	RestError,
} from "@fnb/zalo-mini";
import {
	createRestOrderingClient,
	INBOX_FUNCTIONS,
	type OrderingClient,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import { DEMO_POLICY_VERSION } from "./fixtures";
import { DEMO_ORDERING_STORE, DEMO_SIZES } from "./ordering-fixtures";
import { createOrderingWorld } from "./ordering-world";
import { createDemoWorld, DEMO_DEFAULTS } from "./world";

// Test design (ISTQB) for C12 in the demo world, the stand-in of the server the browser tests run on (it must answer
// as docs/api.md 3.31 says, or the app is tested against a fiction):
// - a decision table of the till's actions and the items they write (paid, brought to the table, completed with its
//   stamps, a paid order cancelled and refunded), and the ones that write none (placing, starting, the customer's
//   own cancellation), as the server's triggers do;
// - boundary values of the page (20 and 21 items, the cursor) and of the read mark's ids (0, 101, a malformed id);
// - state transitions of an item (unread -> read, read stays read) and of the consent (a visitor refused, a member
//   on, a replay, a version never published refused);
// - a campaign's offer only with the marketing consent (GA-066).

const START = Date.UTC(2026, 10, 28, 3, 0, 0); // 10:00 in Vietnam
const TEA = DEMO_SIZES.lotusTea;
const TABLE = "demo-table-12";

async function setup(member = false, marketing = false) {
	let clock = START;
	const world = createDemoWorld(
		{ ...DEMO_DEFAULTS, member, marketing },
		() => clock,
	);
	const ordering = createOrderingWorld(
		world.now,
		null,
		false,
		member,
		true,
		false,
		{
			joined: () => world.joined(),
			marketing: () => world.marketing(),
			setMarketing: (on) => world.setMarketing(on),
			policyVersion: DEMO_POLICY_VERSION,
		},
	);
	world.extend(ordering);
	const sessions = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	const state = await sessions.connect();
	if (state.status !== "ready") throw new Error("no session");
	const rest = world.rest(state.session.accessToken);
	const client: OrderingClient = createRestOrderingClient(rest);
	let requests = 0;
	const place = async (qty = 1) => {
		requests += 1;
		const answer = await client.placeOrder({
			request_id: `12345678-1234-4234-8234-${String(requests).padStart(12, "0")}`,
			store: DEMO_ORDERING_STORE,
			type: "table",
			table_token: TABLE,
			lines: [{ size: TEA, qty }],
			payment: "counter",
			expected_total: 49000 * qty,
		});
		if (answer.order === null) throw new Error(`refused: ${answer.refusal}`);
		return answer.order.id;
	};
	return {
		world,
		till: ordering.till,
		client,
		rest,
		place,
		tick: (ms: number) => {
			clock += ms;
		},
	};
}

describe("the till's actions write the items the server's triggers write", () => {
	it("pay, bring to the table and complete: a receipt, ready, then the stamps; placing and starting write nothing", async () => {
		const demo = await setup();
		const order = await demo.place(2);
		expect(demo.till.inbox()).toEqual([]);
		demo.till.act("pay", order);
		demo.till.act("start", order);
		expect(demo.till.inbox()).toEqual(["order_receipt"]);
		demo.till.act("done", order);
		demo.till.act("complete", order);
		expect(demo.till.inbox()).toEqual([
			"stamp",
			"order_ready",
			"order_receipt",
		]);
		const page = await demo.client.inbox("all", null);
		expect(page.unread).toBe(3);
		expect(page.items[0]).toMatchObject({
			kind: "stamp",
			target: "stamps",
			rewardName: "Ly miễn phí",
			params: { added: 2, left: 7 },
		});
		expect(page.items[1]).toMatchObject({
			kind: "order_ready",
			target: "order",
			orderId: order,
			order: { tableLabel: "Bàn 12", items: 2 },
		});
		expect(page.items[2]?.params.amount).toBe(98000);
	});

	it("a paid order the shop cancels and refunds: cancelled with the refund due, then refunded in cash that day", async () => {
		const demo = await setup();
		const order = await demo.place();
		demo.till.act("pay", order);
		demo.till.act("refund", order);
		const page = await demo.client.inbox("orders", null);
		expect(page.items.map((item) => item.kind)).toEqual([
			"order_refunded",
			"order_cancelled",
			"order_receipt",
		]);
		expect(page.items[1]?.params).toMatchObject({
			reason: "store_busy",
			refundDue: 49000,
		});
		expect(page.items[0]?.params).toMatchObject({
			amount: 49000,
			method: "cash",
			refundedOn: "2026-11-28",
		});
	});

	it("the customer's own cancellation writes nothing", async () => {
		const demo = await setup();
		const order = await demo.place();
		await demo.client.cancelOrder(order);
		expect(demo.till.inbox()).toEqual([]);
	});
});

describe("the page and the read marks", () => {
	it("reads 20 items, then the 21st with no next page, and filters orders and offers", async () => {
		const demo = await setup();
		for (let index = 0; index < 7; index += 1) {
			const order = await demo.place();
			demo.till.act("pay", order);
			demo.till.act("start", order);
			demo.till.act("done", order);
			demo.till.act("complete", order);
		}
		expect(demo.till.inbox()).toHaveLength(21);
		const first = await demo.client.inbox("all", null);
		expect(first.items).toHaveLength(20);
		expect(first.nextBefore).toBe(first.items[19]?.cursor);
		const second = await demo.client.inbox("all", first.nextBefore);
		expect(second.items).toHaveLength(1);
		expect(second.nextBefore).toBeNull();
		expect(
			(await demo.client.inbox("offers", null)).items.every(
				(item) => item.topic === "offers",
			),
		).toBe(true);
		expect((await demo.client.inbox("orders", null)).items).toHaveLength(14);
	});

	it("marks one item read, keeps its first time, then every one; refuses 0 or 101 ids", async () => {
		const demo = await setup();
		const order = await demo.place();
		demo.till.act("pay", order);
		demo.till.act("start", order);
		demo.till.act("done", order);
		const [ready] = (await demo.client.inbox("all", null)).items;
		expect(await demo.client.markInboxRead([ready?.id ?? ""])).toEqual({
			state: "read",
			marked: 1,
			unread: 1,
		});
		demo.tick(60_000);
		expect(await demo.client.markInboxRead([ready?.id ?? ""])).toEqual({
			state: "read",
			marked: 0,
			unread: 1,
		});
		expect((await demo.client.inbox("all", null)).items[0]?.readAt).toBe(
			new Date(START).toISOString(),
		);
		expect(await demo.client.markInboxRead(null)).toEqual({
			state: "read",
			marked: 1,
			unread: 0,
		});
		expect((await demo.client.inboxUnread()).unread).toBe(0);
		await expect(
			demo.rest.rpc(INBOX_FUNCTIONS.read, { p_ids: [] }),
		).rejects.toBeInstanceOf(RestError);
		await expect(
			demo.rest.rpc(INBOX_FUNCTIONS.read, {
				p_ids: Array.from(
					{ length: 101 },
					(_, n) => `12345678-1234-4234-8234-${String(n).padStart(12, "0")}`,
				),
			}),
		).rejects.toBeInstanceOf(RestError);
		await expect(
			demo.rest.rpc(INBOX_FUNCTIONS.inbox, {
				p_filter: "events",
				p_before: null,
			}),
		).rejects.toBeInstanceOf(RestError);
	});
});

describe("the marketing switch and the campaigns", () => {
	it("refuses a visitor's consent, as the server's 42501", async () => {
		const demo = await setup(false);
		expect((await demo.client.inbox("all", null)).marketing).toEqual({
			member: false,
			consent: false,
			weeklyCap: 2,
		});
		await expect(
			demo.client.startMarketing(
				DEMO_POLICY_VERSION,
				new Date(START).toISOString(),
			),
		).rejects.toBeInstanceOf(RestError);
	});

	it("turns a member's consent on, answers a replay, refuses a version never published", async () => {
		const demo = await setup(true);
		expect(
			await demo.client.startMarketing(
				"privacy-demo-9",
				new Date(START).toISOString(),
			),
		).toMatchObject({
			state: "refused",
			refusal: "policy_outdated",
		});
		expect(
			await demo.client.startMarketing(
				DEMO_POLICY_VERSION,
				new Date(START).toISOString(),
			),
		).toMatchObject({
			state: "started",
			replayed: false,
		});
		expect(demo.world.marketing()).toBe(true);
		expect((await demo.client.inbox("all", null)).marketing.consent).toBe(true);
		expect(
			await demo.client.startMarketing(
				DEMO_POLICY_VERSION,
				new Date(START).toISOString(),
			),
		).toMatchObject({ replayed: true });
	});

	it("writes a campaign's offer only for a member who consented", async () => {
		expect(
			(await setup(true, false)).till.offer(
				"Ưu đãi cuối tuần",
				"Giảm giá trước 10 giờ",
			),
		).toBe(false);
		const demo = await setup(true, true);
		expect(demo.till.offer("Ưu đãi cuối tuần", "Giảm giá trước 10 giờ")).toBe(
			true,
		);
		const [offer] = (await demo.client.inbox("offers", null)).items;
		expect(offer).toMatchObject({
			kind: "offer",
			target: "offers",
			title: "Ưu đãi cuối tuần",
			params: { offer: "campaign" },
		});
	});
});
