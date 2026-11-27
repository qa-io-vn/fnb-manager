import { describe, expect, it } from "vitest";
import type { RestClient } from "../../src/data/rest-client";
import {
	isOpenStatus,
	ORDER_STATUSES,
	ORDERING_FUNCTIONS,
	orderArgs,
	readCallAnswer,
	readCancelAnswer,
	readCartCheck,
	readMenu,
	readMenuVersion,
	readOrderAnswer,
	readOrderList,
	readPlaceAnswer,
	readStampCard,
	readTableAnswer,
} from "../../src/ordering/contract";
import { createRestOrderingClient } from "../../src/ordering/rest-ordering-client";

// Test design (ISTQB) for the native till's wire contract (docs/api.md 3.27):
// - equivalence partitions per answer: a valid answer, each refusal shape, and malformed answers (a missing field, a
//   wrong type, an id that is not a UUID, a negative or fractional price), which every reader refuses;
// - boundary values on prices (0 and the largest safe integer accepted, -1 and 1.5 refused) and option group limits
//   (max 1 with min 0 accepted, max 0 or max < min refused);
// - the argument builders: the function names and parameter names the SQL declares, and an order id that is not a
//   UUID refused before any call (no injection into the path or the body).

const SIZE = "11111111-1111-4111-8111-111111111101";
const SIZE_L = "11111111-1111-4111-8111-111111111102";
const ITEM = "22222222-2222-4222-8222-222222222201";
const CATEGORY = "33333333-3333-4333-8333-333333333301";
const GROUP = "44444444-4444-4444-8444-444444444401";
const OPTION = "55555555-5555-4555-8555-555555555501";
const ORDER = "66666666-6666-4666-8666-666666666601";

const ORDERING = {
	accepting: true,
	reason: null,
	till_mode: "native",
	order_types: ["table"],
	payment_methods: ["counter"],
	opens_at: null,
	closes_at: "2026-11-27T16:00:00+00:00",
	last_order_at: "2026-11-27T15:45:00+00:00",
	paused_until: null,
	closure_reason: null,
	closure_ends_on: null,
};

const MENU = {
	store: {
		code: "mau-1",
		name: "Quán Mẫu Một",
		address: "1 Đường Mẫu",
		opening_hours: { mon: [["07:00", "22:00"]] },
	},
	order_type: "table",
	ordering: ORDERING,
	menu_version: 7,
	currency: "VND",
	categories: [
		{
			id: CATEGORY,
			name: "Cà phê",
			items: [
				{
					id: ITEM,
					name: "Cà phê sữa",
					description: "Pha phin",
					photo_path: null,
					labels: ["best_seller"],
					order_types: ["table", "takeaway"],
					counts_for_stamps: true,
					sizes: [
						{ id: SIZE, label: "Vừa", price: 35000, is_default: true },
						{ id: SIZE_L, label: "Lớn", price: 45000, is_default: false },
					],
					option_group_ids: [GROUP],
				},
			],
		},
	],
	option_groups: [
		{
			id: GROUP,
			name: "Đá",
			min_select: 0,
			max_select: 1,
			options: [
				{ id: OPTION, name: "Ít đá", price_delta: 0, is_default: false },
			],
		},
	],
	unavailable_items: [],
};

const LINE = {
	line_no: 1,
	item_id: ITEM,
	size_id: SIZE,
	item_name: "Cà phê sữa",
	size_label: "Vừa",
	quantity: 2,
	unit_price: 35000,
	options: [
		{
			group_id: GROUP,
			group: "Đá",
			option_id: OPTION,
			name: "Ít đá",
			price: 0,
		},
	],
	options_amount: 0,
	line_total: 70000,
	counts_for_stamps: true,
	note: "<b>ít ngọt</b>",
};

const ORDER_JSON = {
	id: ORDER,
	order_no: 7,
	display_no: "#007",
	business_date: "2026-11-27",
	source: "app",
	type: "table",
	table: { id: null, label: "Bàn 12" },
	pickup_at: null,
	status: "accepted",
	payment_status: "unpaid",
	payment_method: "counter",
	version: 1,
	subtotal: 70000,
	discount_amount: 0,
	total: 70000,
	note: null,
	placed_at: "2026-11-27T03:00:00+00:00",
	payment_due_at: null,
	accepted_at: "2026-11-27T03:00:00+00:00",
	preparing_at: null,
	done_at: null,
	completed_at: null,
	paid_at: null,
	cancelled_at: null,
	cancel_reason: null,
	late: false,
	lines: [LINE],
	timeline: [
		{
			kind: "status",
			action: "placed",
			from: null,
			to: "accepted",
			actor: "customer",
			actor_user_id: null,
			reason_code: null,
			reason_text: null,
			amount: 70000,
			at: "2026-11-27T03:00:00+00:00",
		},
	],
	money: { paid: 0, refunded: 0, refund_open: 0, payments: [], refunds: [] },
};

describe("the ordering contract readers", () => {
	it("read a menu with its sizes, option groups and ordering state", () => {
		const menu = readMenu(MENU);
		expect(menu.menuVersion).toBe(7);
		expect(menu.ordering).toMatchObject({
			accepting: true,
			reason: null,
			orderTypes: ["table"],
			paymentMethods: ["counter"],
		});
		const item = menu.categories[0]?.items[0];
		expect(item).toMatchObject({
			id: ITEM,
			categoryId: CATEGORY,
			labels: ["best_seller"],
			countsForStamps: true,
			optionGroupIds: [GROUP],
		});
		expect(item?.sizes.map((size) => size.price)).toEqual([35000, 45000]);
		expect(menu.optionGroups[0]).toMatchObject({ minSelect: 0, maxSelect: 1 });
	});

	it("accept price boundaries 0 and the largest safe integer, and refuse -1 and 1.5", () => {
		const withPrice = (price: unknown) => ({
			...MENU,
			categories: [
				{
					...MENU.categories[0],
					items: [
						{
							...MENU.categories[0]?.items[0],
							sizes: [{ id: SIZE, label: null, price, is_default: true }],
						},
					],
				},
			],
		});
		expect(() => readMenu(withPrice(0))).not.toThrow();
		expect(() => readMenu(withPrice(Number.MAX_SAFE_INTEGER))).not.toThrow();
		expect(() => readMenu(withPrice(-1))).toThrow(/size price/);
		expect(() => readMenu(withPrice(1.5))).toThrow(/size price/);
		expect(() => readMenu(withPrice("35000"))).toThrow(/size price/);
	});

	it("refuse an item without a size, an id that is not a UUID, and option group limits that cannot hold", () => {
		const noSize = structuredClone(MENU);
		(noSize.categories[0]?.items[0] as { sizes: unknown[] }).sizes = [];
		expect(() => readMenu(noSize)).toThrow(/item sizes/);
		const badId = structuredClone(MENU);
		(badId.categories[0]?.items[0] as { id: string }).id = "1; drop table";
		expect(() => readMenu(badId)).toThrow(/item id/);
		const group = (min: number, max: number) => ({
			...MENU,
			option_groups: [
				{ ...MENU.option_groups[0], min_select: min, max_select: max },
			],
		});
		expect(() => readMenu(group(0, 1))).not.toThrow();
		expect(() => readMenu(group(0, 0))).toThrow(/limits/);
		expect(() => readMenu(group(2, 1))).toThrow(/limits/);
		expect(() => readMenu(null)).toThrow(/menu/);
	});

	it("read the cheap version poll with the sold-out items", () => {
		expect(
			readMenuVersion({
				menu_version: 8,
				ordering: { ...ORDERING, accepting: false, reason: "paused" },
				unavailable_items: [ITEM],
			}),
		).toMatchObject({
			menuVersion: 8,
			ordering: { accepting: false, reason: "paused" },
			unavailableItems: [ITEM],
		});
		expect(() =>
			readMenuVersion({
				menu_version: 8,
				ordering: ORDERING,
				unavailable_items: ["x"],
			}),
		).toThrow(/unavailable items/);
	});

	it("read a table, and each table refusal alike", () => {
		expect(
			readTableAnswer({
				state: "ok",
				table: { label: "Bàn 12", area: "Tầng 1" },
			}),
		).toEqual({ state: "ok", label: "Bàn 12", area: "Tầng 1" });
		expect(
			readTableAnswer({ state: "refused", refusal: "table_unknown" }),
		).toEqual({
			state: "refused",
			refusal: "table_unknown",
			retryAt: null,
		});
		expect(
			readTableAnswer({
				state: "refused",
				refusal: "rate_limited",
				retry_at: "2026-11-27T03:15:00+00:00",
			}),
		).toMatchObject({
			refusal: "rate_limited",
			retryAt: "2026-11-27T03:15:00+00:00",
		});
		expect(() => readTableAnswer({ state: "ok" })).toThrow(/table/);
		expect(() =>
			readTableAnswer({ state: "refused", refusal: "DROP" }),
		).toThrow(/refusal/);
	});

	it("read a staff call and a replayed one", () => {
		expect(
			readCallAnswer({
				state: "calling",
				called_at: "2026-11-27T03:00:00+00:00",
				replayed: true,
			}),
		).toEqual({
			state: "calling",
			calledAt: "2026-11-27T03:00:00+00:00",
			replayed: true,
		});
		expect(() => readCallAnswer({ state: "calling" })).toThrow(/called_at/);
	});

	it("read a cart check, priced or refused with the items that went", () => {
		const ok = readCartCheck({
			state: "ok",
			refusal: null,
			unavailable_items: [],
			bad_lines: [],
			lines: [LINE],
			subtotal: 70000,
			discount_amount: 0,
			total: 70000,
			reward: null,
			menu_version: 7,
			ordering: ORDERING,
		});
		expect(ok.total).toBe(70000);
		expect(ok.lines[0]?.note).toBe("<b>ít ngọt</b>");
		const refused = readCartCheck({
			state: "refused",
			refusal: "item_unavailable",
			unavailable_items: [ITEM],
			bad_lines: [],
			lines: [],
			subtotal: null,
			discount_amount: 0,
			total: null,
			reward: null,
			menu_version: 8,
			ordering: ORDERING,
		});
		expect(refused).toMatchObject({
			state: "refused",
			refusal: "item_unavailable",
			unavailableItems: [ITEM],
			total: null,
		});
	});

	it("read a placement: placed, replayed, and each refusal shape", () => {
		const placed = readPlaceAnswer({
			state: "placed",
			refusal: null,
			replayed: true,
			order: ORDER_JSON,
		});
		expect(placed).toMatchObject({ state: "placed", replayed: true });
		expect(placed.order?.displayNo).toBe("#007");
		expect(placed.order?.tableLabel).toBe("Bàn 12");
		const changed = readPlaceAnswer({
			state: "refused",
			refusal: "price_changed",
			replayed: false,
			order: null,
			total: 75000,
			discount_amount: 0,
			menu_version: 9,
			lines: [LINE],
		});
		expect(changed).toMatchObject({
			refusal: "price_changed",
			total: 75000,
			badLines: [],
		});
		const options = readPlaceAnswer({
			state: "refused",
			refusal: "option_invalid",
			replayed: false,
			order: null,
			lines: [2],
			menu_version: 9,
		});
		expect(options.badLines).toEqual([2]);
		const closed = readPlaceAnswer({
			state: "refused",
			refusal: "closed_now",
			replayed: false,
			order: null,
			ordering: { ...ORDERING, accepting: false, reason: "closed_now" },
		});
		expect(closed.ordering?.reason).toBe("closed_now");
		expect(() => readPlaceAnswer({ state: "maybe" })).toThrow(
			/placement state/,
		);
		expect(() =>
			readPlaceAnswer({
				state: "placed",
				refusal: null,
				order: { ...ORDER_JSON, total: -5 },
			}),
		).toThrow(/total/);
	});

	it("read an order with its timeline and money, and an unknown order as refused", () => {
		const answer = readOrderAnswer({
			state: "ok",
			refusal: null,
			order: ORDER_JSON,
		});
		if (answer.state !== "ok") throw new Error("not ok");
		expect(answer.order.timeline[0]).toMatchObject({
			action: "placed",
			to: "accepted",
		});
		expect(answer.order.money?.paid).toBe(0);
		expect(answer.order.readyEstimateAt).toBeNull();
		expect(
			readOrderAnswer({
				state: "refused",
				refusal: "unknown_order",
				order: null,
			}),
		).toEqual({
			state: "refused",
			refusal: "unknown_order",
		});
		expect(() =>
			readOrderAnswer({
				state: "ok",
				order: { ...ORDER_JSON, status: "eaten" },
			}),
		).toThrow(/order status/);
	});

	it("read a cancellation, a refused one with the order, and the list of orders", () => {
		expect(
			readCancelAnswer({
				state: "cancelled",
				refusal: null,
				replayed: false,
				order: {
					...ORDER_JSON,
					status: "cancelled",
					cancel_reason: "customer_cancelled",
				},
			}),
		).toMatchObject({ state: "cancelled", order: { status: "cancelled" } });
		expect(
			readCancelAnswer({
				state: "refused",
				refusal: "contact_store",
				order: ORDER_JSON,
			}),
		).toMatchObject({ state: "refused", refusal: "contact_store" });
		const list = readOrderList({
			orders: [
				{
					id: ORDER,
					display_no: "#007",
					store_name: "Quán Mẫu Một",
					type: "table",
					table_label: "Bàn 12",
					status: "completed",
					payment_status: "paid",
					total: 70000,
					placed_at: "2026-11-27T03:00:00+00:00",
					items: 2,
				},
			],
			next_before: null,
		});
		expect(list.orders[0]).toMatchObject({ displayNo: "#007", items: 2 });
	});

	it("read the stamp card, its rewards and history", () => {
		const card = readStampCard({
			enabled: true,
			stamps: 4,
			stamps_per_reward: 9,
			reward_name: "Ly miễn phí",
			total_earned: 13,
			rewards: [{ id: ORDER, issued_at: "2026-11-20T03:00:00+00:00" }],
			history: [
				{
					kind: "order_earned",
					delta: 2,
					balance_after: 4,
					at: "2026-11-26T03:00:00+00:00",
					order_no: "#003",
				},
				{
					kind: "order_reversed",
					delta: -1,
					balance_after: 2,
					at: "2026-11-25T03:00:00+00:00",
					order_no: null,
				},
			],
		});
		expect(card).toMatchObject({
			stamps: 4,
			stampsPerReward: 9,
			totalEarned: 13,
		});
		expect(card.history.map((entry) => entry.delta)).toEqual([2, -1]);
		expect(() => readStampCard({ ...card, stamps_per_reward: 0 })).toThrow();
	});

	it("know the open statuses of the lifecycle", () => {
		expect(ORDER_STATUSES.filter(isOpenStatus)).toEqual([
			"awaiting_payment",
			"accepted",
			"preparing",
			"ready",
			"serving",
		]);
	});
});

describe("the REST ordering client", () => {
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

	it("call the functions the SQL declares with its parameter names", async () => {
		const menu = recording(MENU);
		await menu.client.menu("mau-1", "table");
		expect(menu.calls).toEqual([
			{
				fn: ORDERING_FUNCTIONS.menu,
				args: { p_store_code: "mau-1", p_order_type: "table" },
			},
		]);
		const table = recording({
			state: "ok",
			table: { label: "Bàn 1", area: null },
		});
		await table.client.table("mau-1", "tok_EN-1");
		expect(table.calls[0]).toEqual({
			fn: "customer_table",
			args: { p_store_code: "mau-1", p_table_token: "tok_EN-1" },
		});
		const order = recording({ state: "ok", order: ORDER_JSON });
		await order.client.order(ORDER);
		expect(order.calls[0]).toEqual({
			fn: "customer_order",
			args: { p_order: ORDER },
		});
		const orders = recording({ orders: [], next_before: null });
		await orders.client.orders(null);
		expect(orders.calls[0]).toEqual({ fn: "customer_orders", args: {} });
		const place = recording({
			state: "placed",
			refusal: null,
			replayed: false,
			order: ORDER_JSON,
		});
		const request = {
			request_id: ORDER,
			store: "mau-1",
			type: "table" as const,
			table_token: "tok",
			lines: [{ size: SIZE, qty: 2 }],
			payment: "counter" as const,
			expected_total: 70000,
		};
		await place.client.placeOrder(request);
		expect(place.calls[0]).toEqual({
			fn: "customer_place_order",
			args: { p_request: request },
		});
	});

	it("refuse an order id that is not a UUID before calling", async () => {
		const order = recording({ state: "ok", order: ORDER_JSON });
		await expect(order.client.order("../wallet")).rejects.toThrow(/UUID/);
		expect(order.calls).toEqual([]);
		expect(() => orderArgs("x' or '1'='1")).toThrow();
	});
});
