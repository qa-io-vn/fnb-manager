// The customer app's ordering against the real native-till functions of the local stack (docs/api.md 3.27), in two
// parts. The first calls the functions as the Data API would (a customer or a staff JWT's claims, the authenticated
// role) and reads every answer with the app's own readers: integration of the wire contract, and the security cases
// that only the server can prove (a forged or rotated table token, a tampered price or size, another customer's order,
// a hostile note kept as text, one order per request_id). The second runs the ordering build in the browser through
// pnpm zalo:dev --live on a synthetic tenant and moves the order from the database as the counter would, so the
// screen follows every state. Synthetic tenants only (zalo-it-ordering-<hex>), removed afterwards; no iPOS, no Zalo.
import { randomUUID } from "node:crypto";
import {
	readCallAnswer,
	readCancelAnswer,
	readCartCheck,
	readMenu,
	readMenuVersion,
	readOrderAnswer,
	readOrderList,
	readPickupChangeAnswer,
	readPlaceAnswer,
	readStampCard,
	readTableAnswer,
	readTakeawaySlots,
} from "@fnb/zalo-mini/ordering";
import { expect, test } from "@playwright/test";
import { EMPTY_CART, requestLines } from "../src/ordering/cart";
import { applyReorder, planReorder, sameStore } from "../src/ordering/reorder";
import { watchCustomerPage } from "./customer-checks";
import {
	LocalLoop,
	localDatabaseUrl,
	localStackRuns,
	portOf,
} from "./local-loop";
import {
	type OrderingFixture,
	openOrderingFixture,
	type Sql,
} from "./ordering-fixture";

const ONE = async <T>(rows: Promise<{ r: T }[]>): Promise<T> => {
	const [row] = await rows;
	if (row === undefined) throw new Error("no answer");
	return row.r;
};

function call(tx: Sql, fn: string, ...args: unknown[]) {
	// the public wrappers, as the Data API calls them under the authenticated role
	switch (fn) {
		case "menu":
			return ONE(
				tx`select public.customer_menu(${args[0] as string}, null) as r`,
			);
		case "version":
			return ONE(
				tx`select public.customer_menu_version(${args[0] as string}) as r`,
			);
		case "table":
			return ONE(
				tx`select public.customer_table(${args[0] as string}, ${args[1] as string}) as r`,
			);
		case "callStaff":
			return ONE(
				tx`select public.customer_call_staff(${args[0] as string}, ${args[1] as string}) as r`,
			);
		case "check":
			return ONE(
				tx`select public.customer_check_cart(${tx.json(args[0]) as string}::jsonb) as r`,
			);
		case "place":
			return ONE(
				tx`select public.customer_place_order(${tx.json(args[0]) as string}::jsonb) as r`,
			);
		case "order":
			return ONE(
				tx`select public.customer_order(${args[0] as string}::uuid) as r`,
			);
		case "orders":
			return ONE(tx`select public.customer_orders(null) as r`);
		case "cancel":
			return ONE(
				tx`select public.customer_cancel_order(${args[0] as string}::uuid) as r`,
			);
		case "stamps":
			return ONE(tx`select public.customer_stamp_card() as r`);
		case "slots":
			return ONE(
				tx`select public.customer_takeaway_slots(${args[0] as string}) as r`,
			);
		case "pickup":
			return ONE(
				tx`select public.customer_change_pickup(${args[0] as string}::uuid, ${args[1] as string}::timestamptz) as r`,
			);
		default:
			throw new Error(fn);
	}
}

async function counter(
	fixture: OrderingFixture,
	orderId: string,
	action: "pay" | "start" | "done" | "complete",
) {
	return fixture.asStaff(async (tx) => {
		const order = await ONE<{ version: number; total: number }>(
			tx`select public.counter_order(${orderId}::uuid) as r`,
		);
		if (action === "pay")
			return ONE(
				tx`select public.counter_record_payment(${orderId}::uuid, 'cash', ${order.total}, ${order.version}) as r`,
			);
		return ONE(
			tx`select public.counter_order_act(${orderId}::uuid, ${action}, ${order.version}, null) as r`,
		);
	});
}

test.describe("the wire contract and the server's refusals", () => {
	let fixture: OrderingFixture | null = null;

	test.beforeEach(async () => {
		const url = localDatabaseUrl();
		test.skip(
			url === "",
			"set DATABASE_URL to the local stack's loopback database",
		);
		fixture = await openOrderingFixture(url, { ownBrand: true });
		await fixture.makeNative();
	});

	test.afterEach(async () => {
		await fixture?.cleanup();
		fixture = null;
	});

	test("every answer reads with the app's readers, and an order goes through every state from the database", async () => {
		if (fixture === null) throw new Error("no fixture");
		const f = fixture;
		const menu = f.menu();
		const [customer] = f.customers;
		if (customer === undefined) throw new Error("no customer");
		await f.asCustomer(customer, async (tx) => {
			const read = readMenu(await call(tx, "menu", f.storeCode));
			expect(read.ordering).toMatchObject({
				accepting: true,
				orderTypes: ["table"],
				paymentMethods: ["counter"],
			});
			const coffee = read.categories
				.flatMap((c) => c.items)
				.find((i) => i.id === menu.coffee);
			expect(coffee?.sizes.map((s) => s.price)).toEqual([35000, 45000]);
			expect(read.optionGroups[0]?.options[0]?.priceDelta).toBe(10000);
			expect(
				readMenuVersion(await call(tx, "version", f.storeCode))
					.unavailableItems,
			).toEqual([]);
			expect(
				readTableAnswer(await call(tx, "table", f.storeCode, menu.tableToken)),
			).toEqual({
				state: "ok",
				label: "Bàn 12",
				area: "Tầng 1",
			});
			const lines = [
				{ size: menu.coffeeL, qty: 2, options: [menu.shot], note: "ít ngọt" },
				{ size: menu.cakeSize, qty: 1 },
			];
			const check = readCartCheck(
				await call(tx, "check", {
					store: f.storeCode,
					type: "table",
					table_token: menu.tableToken,
					lines,
				}),
			);
			expect(check).toMatchObject({
				state: "ok",
				subtotal: 135000,
				total: 135000,
			});
		});
		const placed = await f.asCustomer(customer, async (tx) =>
			readPlaceAnswer(
				await call(tx, "place", {
					request_id: randomUUID(),
					store: f.storeCode,
					type: "table",
					table_token: menu.tableToken,
					payment: "counter",
					lines: [
						{
							size: menu.coffeeL,
							qty: 2,
							options: [menu.shot],
							note: "ít ngọt",
						},
						{ size: menu.cakeSize, qty: 1 },
					],
					expected_total: 135000,
				}),
			),
		);
		expect(placed).toMatchObject({ state: "placed", replayed: false });
		const orderId = placed.order?.id ?? "";
		expect(placed.order).toMatchObject({
			status: "accepted",
			paymentStatus: "unpaid",
			tableLabel: "Bàn 12",
			total: 135000,
		});

		const statuses: string[] = [];
		for (const step of ["pay", "start", "done", "complete"] as const) {
			await counter(f, orderId, step);
			const answer = await f.asCustomer(customer, async (tx) =>
				readOrderAnswer(await call(tx, "order", orderId)),
			);
			if (answer.state !== "ok") throw new Error("no order");
			statuses.push(`${answer.order.status}/${answer.order.paymentStatus}`);
		}
		expect(statuses).toEqual([
			"accepted/paid",
			"preparing/paid",
			"serving/paid",
			"completed/paid",
		]);
		await f.asCustomer(customer, async (tx) => {
			const list = readOrderList(await call(tx, "orders"));
			expect(list.orders.map((o) => o.status)).toEqual(["completed"]);
			const card = readStampCard(await call(tx, "stamps"));
			// two coffees count, the cake does not
			expect(card).toMatchObject({ stamps: 2, stampsPerReward: 9 });
			const order = readOrderAnswer(await call(tx, "order", orderId));
			if (order.state !== "ok") throw new Error("no order");
			expect(order.order.lines[0]?.note).toBe("ít ngọt");
			expect(order.order.timeline.map((e) => e.to)).toContain("completed");
			// "Đặt lại" (C14) rebuilds from the real answers: the lines' item, size and option ids, the history's store
			// name against the menu's, and the same request again from today's menu, with no price in it
			expect(order.order.lines[0]).toMatchObject({
				itemId: menu.coffee,
				sizeId: menu.coffeeL,
			});
			expect(order.order.lines[0]?.options.map((o) => o.optionId)).toEqual([
				menu.shot,
			]);
			const current = readMenu(await call(tx, "menu", f.storeCode));
			const [summary] = list.orders;
			if (summary === undefined) throw new Error("no order in the list");
			expect(sameStore(summary, current)).toBe(true);
			const plan = planReorder(order.order, current);
			expect(plan.leftOut).toEqual([]);
			expect(
				requestLines(
					applyReorder(EMPTY_CART, f.storeCode, plan, "replace").cart,
				),
			).toEqual([
				{ size: menu.coffeeL, qty: 2, options: [menu.shot], note: "ít ngọt" },
				{ size: menu.cakeSize, qty: 1 },
			]);
			expect(
				readCallAnswer(
					await call(tx, "callStaff", f.storeCode, menu.tableToken),
				),
			).toMatchObject({
				state: "calling",
				replayed: false,
			});
			expect(
				readCallAnswer(
					await call(tx, "callStaff", f.storeCode, menu.tableToken),
				),
			).toMatchObject({
				state: "calling",
				replayed: true,
			});
		});
	});

	test("the server refuses a forged or rotated table token, a tampered price or size, and another customer's order", async () => {
		if (fixture === null) throw new Error("no fixture");
		const f = fixture;
		const menu = f.menu();
		const [mine, theirs] = f.customers;
		if (mine === undefined || theirs === undefined)
			throw new Error("no customers");
		const request = (extra: Record<string, unknown> = {}) => ({
			request_id: randomUUID(),
			store: f.storeCode,
			type: "table",
			table_token: menu.tableToken,
			payment: "counter",
			lines: [{ size: menu.coffeeM, qty: 1 }],
			expected_total: 35000,
			...extra,
		});
		await f.asCustomer(mine, async (tx) => {
			expect(
				readTableAnswer(
					await call(tx, "table", f.storeCode, "Ban12-forged-token-0000"),
				),
			).toMatchObject({
				state: "refused",
				refusal: "table_unknown",
			});
			expect(
				readPlaceAnswer(
					await call(tx, "place", request({ table_token: "Ban12-forged" })),
				),
			).toMatchObject({
				state: "refused",
				refusal: "table_unknown",
			});
			// a lower total than the menu's: refused with the server's total, no order made
			expect(
				readPlaceAnswer(
					await call(tx, "place", request({ expected_total: 1000 })),
				),
			).toMatchObject({
				state: "refused",
				refusal: "price_changed",
				total: 35000,
			});
			// a size that is not on the store's menu (made up, or another brand's) is not sold
			expect(
				readPlaceAnswer(
					await call(
						tx,
						"place",
						request({ lines: [{ size: randomUUID(), qty: 1 }] }),
					),
				),
			).toMatchObject({ state: "refused", refusal: "item_unavailable" });
			// an option of a group the item does not offer
			expect(
				readPlaceAnswer(
					await call(
						tx,
						"place",
						request({
							lines: [{ size: menu.cakeSize, qty: 1, options: [menu.shot] }],
							expected_total: 35000,
						}),
					),
				),
			).toMatchObject({
				state: "refused",
				refusal: "option_invalid",
				badLines: [1],
			});
		});
		const [rows] = await f.sql<{
			n: number;
		}>`select count(*)::int as n from public.orders where tenant_id = ${f.tenantId}::uuid`;
		expect(rows?.n).toBe(0);

		// one order per request_id: the same request answers the first order, another under the same id is refused
		const first = request({
			lines: [
				{ size: menu.coffeeM, qty: 1, note: '<img src=x onerror="alert(1)">' },
			],
		});
		const placed = await f.asCustomer(mine, async (tx) =>
			readPlaceAnswer(await call(tx, "place", first)),
		);
		const again = await f.asCustomer(mine, async (tx) =>
			readPlaceAnswer(await call(tx, "place", first)),
		);
		expect(again).toMatchObject({
			state: "placed",
			replayed: true,
			order: { id: placed.order?.id },
		});
		const conflict = await f.asCustomer(mine, async (tx) =>
			readPlaceAnswer(
				await call(tx, "place", {
					...first,
					expected_total: 35000,
					lines: [{ size: menu.coffeeL, qty: 1 }],
				}),
			),
		);
		expect(conflict).toMatchObject({
			state: "refused",
			refusal: "request_conflict",
		});
		// the note is kept as the customer typed it; the app writes it as text
		expect(placed.order?.lines[0]?.note).toBe('<img src=x onerror="alert(1)">');
		const [count] = await f.sql<{
			n: number;
		}>`select count(*)::int as n from public.orders where tenant_id = ${f.tenantId}::uuid`;
		expect(count?.n).toBe(1);

		// a bidirectional override in a note is refused before anything is read
		await expect(
			f.asCustomer(mine, async (tx) =>
				call(
					tx,
					"place",
					request({ lines: [{ size: menu.coffeeM, qty: 1, note: "ít‮đá" }] }),
				),
			),
		).rejects.toMatchObject({ code: "22023" });

		// another customer's order answers exactly as an unknown id, for reading and cancelling
		const orderId = placed.order?.id ?? "";
		await f.asCustomer(theirs, async (tx) => {
			const unknown = await call(tx, "order", randomUUID());
			expect(await call(tx, "order", orderId)).toEqual(unknown);
			expect(readOrderAnswer(unknown)).toEqual({
				state: "refused",
				refusal: "unknown_order",
			});
			expect(readCancelAnswer(await call(tx, "cancel", orderId))).toMatchObject(
				{ state: "refused", refusal: "unknown_order" },
			);
		});

		// the counter switches the coffee sold out: the version poll names it and the basket check refuses it
		await f.asStaff(async (tx) =>
			ONE(
				tx`select public.counter_set_sold_out(${f.storeId}::uuid, ${menu.coffee}::uuid, true, null) as r`,
			),
		);
		await f.asCustomer(mine, async (tx) => {
			expect(
				readMenuVersion(await call(tx, "version", f.storeCode))
					.unavailableItems,
			).toEqual([menu.coffee]);
			expect(
				readMenu(await call(tx, "menu", f.storeCode)).categories.flatMap((c) =>
					c.items.map((i) => i.id),
				),
			).toEqual([menu.cake]);
			expect(
				readCartCheck(
					await call(tx, "check", {
						store: f.storeCode,
						type: "table",
						table_token: menu.tableToken,
						lines: [{ size: menu.coffeeM, qty: 1 }],
					}),
				),
			).toMatchObject({
				state: "refused",
				refusal: "item_unavailable",
				unavailableItems: [menu.coffee],
			});
		});

		// a rotated card is refused at once; the customer's own cancellation of an unpaid order goes through
		await f.asStaff(
			async (tx) =>
				ONE(tx`select public.rotate_table_qr(${menu.tableId}::uuid) as r`),
			f.ownerId,
		);
		await f.asCustomer(mine, async (tx) => {
			expect(
				readTableAnswer(await call(tx, "table", f.storeCode, menu.tableToken)),
			).toMatchObject({ refusal: "table_unknown" });
			expect(readCancelAnswer(await call(tx, "cancel", orderId))).toMatchObject(
				{ state: "cancelled" },
			);
		});
	});
});

test.describe("C17 takeaway on the real functions", () => {
	let fixture: OrderingFixture | null = null;

	test.beforeEach(async () => {
		const url = localDatabaseUrl();
		test.skip(
			url === "",
			"set DATABASE_URL to the local stack's loopback database",
		);
		fixture = await openOrderingFixture(url, { ownBrand: true });
		await fixture.makeNative();
		// takeaway on, prepaid by VietQR, 15 minutes to prepare, one order a slot
		await fixture.sql`
			update public.store_ordering_settings
			set order_types = array['table', 'takeaway'], payment_methods = array['counter', 'vietqr'], prep_minutes = 15,
				takeaway_slot_limit = 1
			where store_id = ${fixture.storeId}::uuid
		`;
	});

	test.afterEach(async () => {
		await fixture?.cleanup();
		fixture = null;
	});

	test("the slots, a booking, the last place, a move and another customer's order read with the app's readers", async () => {
		if (fixture === null) throw new Error("no fixture");
		const f = fixture;
		const menu = f.menu();
		const [mine, theirs] = f.customers;
		if (mine === undefined || theirs === undefined)
			throw new Error("no customers");
		const slots = await f.asCustomer(mine, async (tx) =>
			readTakeawaySlots(await call(tx, "slots", f.storeCode)),
		);
		expect(slots.state).toBe("ok");
		expect(slots.prepMinutes).toBe(15);
		expect(slots.slotMinutes).toBe(15);
		// open around the clock: "Càng sớm" is offered, the earliest slot is at least 15 minutes ahead
		expect(slots.asapAt).not.toBeNull();
		const free = slots.slots.filter((slot) => slot.available);
		const [first, second] = free;
		if (first === undefined || second === undefined)
			throw new Error("no free slots");
		expect(
			Date.parse(first.start) - Date.parse(slots.now),
		).toBeGreaterThanOrEqual(15 * 60_000);
		const booking = (at: string) => ({
			request_id: randomUUID(),
			store: f.storeCode,
			type: "takeaway",
			pickup_at: at,
			lines: [{ size: menu.cakeSize, qty: 1 }],
			payment: "vietqr",
			expected_total: 25000,
		});
		const placed = await f.asCustomer(mine, async (tx) =>
			readPlaceAnswer(await call(tx, "place", booking(first.start))),
		);
		expect(placed.state).toBe("awaiting_payment");
		expect(Date.parse(placed.order?.pickupAt ?? "")).toBe(
			Date.parse(first.start),
		);
		expect(placed.order?.startAt).not.toBeNull();
		const orderId = placed.order?.id ?? "";
		const counter = await f.asCustomer(mine, async (tx) =>
			readPlaceAnswer(
				await call(tx, "place", {
					...booking(second.start),
					payment: "counter",
				}),
			),
		);
		expect(counter.refusal).toBe("payment_not_allowed");
		// the last (and only) place of the slot is taken: the other customer is told it is full
		const full = await f.asCustomer(theirs, async (tx) =>
			readPlaceAnswer(await call(tx, "place", booking(first.start))),
		);
		expect(full.refusal).toBe("slot_full");
		expect(Date.parse(full.pickupAt ?? "")).toBe(Date.parse(first.start));
		const shown = await f.asCustomer(theirs, async (tx) =>
			readTakeawaySlots(await call(tx, "slots", f.storeCode)),
		);
		expect(
			shown.slots.find(
				(slot) => Date.parse(slot.start) === Date.parse(first.start),
			)?.reason,
		).toBe("full");
		// the other customer cannot move my booking; I can, and the place I left is free again
		const foreign = await f.asCustomer(theirs, async (tx) =>
			readPickupChangeAnswer(await call(tx, "pickup", orderId, second.start)),
		);
		expect(foreign).toMatchObject({
			state: "refused",
			refusal: "unknown_order",
		});
		const moved = await f.asCustomer(mine, async (tx) =>
			readPickupChangeAnswer(await call(tx, "pickup", orderId, second.start)),
		);
		expect(moved.state).toBe("changed");
		const again = await f.asCustomer(theirs, async (tx) =>
			readPlaceAnswer(await call(tx, "place", booking(first.start))),
		);
		expect(again.state).toBe("awaiting_payment");
		const list = await f.asCustomer(mine, async (tx) =>
			readOrderList(await call(tx, "orders")),
		);
		expect(
			Date.parse(
				list.orders.find((order) => order.id === orderId)?.pickupAt ?? "",
			),
		).toBe(Date.parse(second.start));
	});
});

test.describe("the ordering build on the local stack, moved from the database", () => {
	let fixture: OrderingFixture | null = null;
	const loops: LocalLoop[] = [];

	test.beforeEach(async ({ page }) => {
		test.skip(
			!(await localStackRuns()),
			"set ZALO_LOCAL_DEV=1 with the local stack running to drive pnpm zalo:dev",
		);
		await watchCustomerPage(page, null);
		fixture = await openOrderingFixture(localDatabaseUrl(), {
			ownBrand: false,
		});
	});

	test.afterEach(async () => {
		for (const loop of loops.splice(0)) await loop.dispose();
		await fixture?.cleanup();
		fixture = null;
	});

	test("a customer scans the table, orders at the counter and follows the order the counter moves to completion", async ({
		page,
	}) => {
		if (fixture === null) throw new Error("no fixture");
		const f = fixture;
		const loop = new LocalLoop();
		loops.push(loop);
		const mockUser = `mock-it-${f.slug.slice(-8)}`;
		const ready = await loop.start([
			"--app",
			"customer",
			"--live",
			"--tenant",
			f.slug,
			"--brand",
			"brand-1",
			"--mock-user",
			mockUser,
			"--mock-name",
			"Khách IT",
			"--port",
			portOf(5791),
		]);
		expect(ready.role).toBe("customer");
		const menu = await f.makeNative();
		await page.goto(
			`${ready.appUrl}?store=${f.storeCode}&src=table&t=${menu.tableToken}`,
		);
		await expect(page.getByTestId("table-banner")).toHaveText(
			"Gọi món cho Bàn 12 · Tầng 1",
		);
		await page.getByRole("button", { name: "Thêm Bánh chuối vào giỏ" }).click();
		await page.getByTestId("cart-bar").getByRole("button").click();
		await expect(page.getByTestId("cart-total")).toHaveAttribute(
			"data-price",
			"25000",
		);
		await page.getByTestId("cart-continue").click();
		const submit = page.getByTestId("checkout-submit");
		await expect(submit).toBeEnabled();
		await expect(page.getByTestId("checkout-total")).toHaveAttribute(
			"data-price",
			"25000",
		);
		await submit.click();
		const order = page.getByTestId("order");
		await expect(order).toHaveAttribute("data-status", "accepted");
		await expect(page.getByTestId("order-headline")).toHaveText(
			"Mời bạn ra quầy thanh toán",
		);
		const [row] = await f.sql<{
			id: string;
		}>`select id::text as id from public.orders where tenant_id = ${f.tenantId}::uuid`;
		if (row === undefined) throw new Error("no order in the database");

		// Gọi nhân viên opens one call of the table at the counter
		await page.getByTestId("order-call").click();
		await expect(page.getByTestId("order-call-sent")).toBeVisible();
		const [calls] = await f.sql<{
			n: number;
		}>`select count(*)::int as n from public.table_calls where tenant_id = ${f.tenantId}::uuid and acknowledged_at is null`;
		expect(calls?.n).toBe(1);

		await counter(f, row.id, "pay");
		await expect(order).toHaveAttribute("data-payment", "paid", {
			timeout: 10_000,
		});
		await counter(f, row.id, "start");
		await expect(order).toHaveAttribute("data-status", "preparing", {
			timeout: 10_000,
		});
		await counter(f, row.id, "done");
		await expect(order).toHaveAttribute("data-status", "serving", {
			timeout: 10_000,
		});
		await expect(page.getByTestId("order-headline")).toHaveText(
			"Quán đang mang ra Bàn 12",
		);
		await counter(f, row.id, "complete");
		await expect(order).toHaveAttribute("data-status", "completed", {
			timeout: 10_000,
		});

		await page
			.getByTestId("order-call")
			.count()
			.then((n) => expect(n).toBe(0));
		const [orders] = await f.sql<{
			n: number;
		}>`select count(*)::int as n from public.orders where tenant_id = ${f.tenantId}::uuid`;
		expect(orders?.n).toBe(1);
	});
});
