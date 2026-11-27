import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
	COFFEE_M,
	placeCustomerOrder,
	seedCustomer,
	TEA,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	nav,
	openShiftFor,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/orders (S02, S03, Q03; acceptance criteria 1 and 4): an app order arriving with the chime and going
// through its whole lifecycle, completion refused while unpaid, cash with change, a late order in red with words, a
// cancel with refund and its audit line, a manager's refund taking the stamps back, two tablets on one order (one
// wins, the other sees the conflict), the network dropping and coming back, and the role and store checks.

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
});

async function customerOrder(
	db: Parameters<typeof placeCustomerOrder>[0],
	seeded: Parameters<typeof placeCustomerOrder>[1],
	table: string,
	lines: { size: string; qty: number; options?: string[] }[] = [
		{ size: "", qty: 1 },
	],
) {
	const customer = await seedCustomer(db, seeded);
	const sized = lines.map((line) => ({
		...line,
		size: line.size === "" ? seeded.sizes.coffeeM : line.size,
	}));
	const total = sized.reduce(
		(sum, line) =>
			sum + line.qty * (line.size === seeded.sizes.tea ? TEA : COFFEE_M),
		0,
	);
	const answer = await placeCustomerOrder(db, seeded, customer, {
		table,
		lines: sized,
		expectedTotal: total,
	});
	expect(answer.state).toBe("placed");
	return { id: answer.order?.id ?? "", customer, total };
}

function card(page: Page, id: string) {
	return page.locator(`[data-testid="order-card"][data-order-id="${id}"]`);
}

test("criterion 1: an app order arrives with the chime, the right table and options, and goes through its lifecycle; completion waits for the payment", async ({
	page,
	seeded,
	db,
	browserName,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await signIn(page, seeded.people.staff);
	await page.getByTestId("sound-chip").click();
	// headless WebKit has no audio output to resume; the chime is still counted below
	if (browserName !== "webkit") {
		await expect(page.getByTestId("sound-chip")).toContainText("Âm báo bật");
	}
	const before = Number(
		(await page.evaluate(() => document.documentElement.dataset.chimes)) ?? "0",
	);
	const placed = await customerOrder(db, seeded, seeded.tables.t2, [
		{ size: seeded.sizes.coffeeM, qty: 1, options: [seeded.options.lessIce] },
		{ size: seeded.sizes.tea, qty: 2 },
	]);
	await expect(card(page, placed.id)).toBeVisible({ timeout: 5_000 });
	await expect(card(page, placed.id)).toContainText("Bàn 2");
	await expect(card(page, placed.id)).toContainText("Ít đá");
	await expect(card(page, placed.id)).toContainText("2× Trà đào");
	await expect(card(page, placed.id)).toContainText("Chưa thu tiền");
	await expect
		.poll(async () =>
			Number(
				await page.evaluate(
					() => document.documentElement.dataset.chimes ?? "0",
				),
			),
		)
		.toBeGreaterThan(before);
	await expect(page.getByTestId("rail-orders")).toContainText("1");

	await card(page, placed.id).getByTestId("open-order").click();
	await page.getByTestId("act-start").click();
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"preparing",
	);
	await page.getByTestId("act-done").click();
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"serving",
	);
	await expect(page.getByText("thu tiền rồi mới hoàn thành")).toBeVisible();
	await page.getByTestId("act-complete").click();
	await expect(page.getByTestId("order-message")).toContainText(
		"Đơn chưa thu tiền",
	);
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"serving",
	);

	await page.getByTestId("open-pay").click();
	await page.getByTestId("pay-given").fill("200000");
	await expect(page.getByTestId("pay-change")).toContainText(
		`${(200_000 - placed.total).toLocaleString("de-DE")}đ`,
	);
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("payment-status")).toContainText("Đã thu tiền");
	await page.getByTestId("act-complete").click();
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"completed",
	);
	const [row] = await db<
		{ status: string; payment_status: string }[]
	>`select status::text, payment_status::text from public.orders where id = ${placed.id}`;
	expect(row).toEqual({ status: "completed", payment_status: "paid" });
});

test("an order waiting longer than the store's minutes is red, with the words", async ({
	page,
	seeded,
	db,
}) => {
	const placed = await customerOrder(db, seeded, seeded.tables.t1);
	await db`update public.orders set accepted_at = now() - interval '25 minutes' where id = ${placed.id}`;
	await signIn(page, seeded.people.staff);
	await expect(card(page, placed.id)).toHaveAttribute("data-late", "true");
	await expect(card(page, placed.id)).toContainText("Chờ lâu");
});

test("criterion 4: a paid order cancelled is refunded in full and the log names who cancelled and refunded, why and how much", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	const placed = await customerOrder(db, seeded, seeded.tables.t1);
	await signIn(page, seeded.people.staff);
	await card(page, placed.id).getByTestId("card-pay").click();
	await page.getByTestId(`pay-quick-${placed.total}`).click();
	await page.getByTestId("pay-submit").click();
	await expect(card(page, placed.id)).not.toContainText("Chưa thu tiền");
	await card(page, placed.id).getByTestId("open-order").click();
	await page.getByTestId("open-cancel").click();
	await expect(page.getByTestId("cancel-submit")).toBeDisabled();
	await page.getByTestId("cancel-reason-other").check();
	await page.getByTestId("cancel-other").fill("Pha");
	await expect(page.getByTestId("cancel-submit")).toBeDisabled();
	await page.getByTestId("cancel-reason-customer_request").check();
	await expect(page.getByTestId("cancel-submit")).toContainText("hoàn 29.000đ");
	await page.getByTestId("cancel-submit").click();
	await expect(page.getByTestId("toast")).toContainText(
		"Đã hủy và hoàn 29.000đ",
	);
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"cancelled",
	);
	await expect(page.getByTestId("payment-status")).toContainText(
		"Đã hoàn tiền",
	);
	const lines = page.getByTestId("audit-line");
	await expect(lines.filter({ hasText: "hủy đơn" })).toContainText(
		`${seeded.people.staff.name} · hủy đơn · Khách đổi ý`,
	);
	await expect(lines.filter({ hasText: "hoàn tiền" }).last()).toContainText(
		"29.000đ",
	);
	const [refund] = await db<
		{ amount: string; status: string; recorded_by: string }[]
	>`
		select amount::text, status, recorded_by::text from public.order_refunds where order_id = ${placed.id}`;
	expect(refund).toEqual({
		amount: "29000.00",
		status: "succeeded",
		recorded_by: seeded.people.staff.id,
	});
});

test("criterion 4: a manager refunds a completed order and its stamp goes back; staff cannot refund it", async ({
	page,
	browser,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	const placed = await customerOrder(db, seeded, seeded.tables.t3);
	await asMember(db, seeded.people.staff.id, async (tx) => {
		const [order] = await tx<
			{ version: number }[]
		>`select version from public.orders where id = ${placed.id}`;
		await tx`select app.counter_record_payment(${placed.id}::uuid, 'cash', ${placed.total}, ${order?.version ?? 1})`;
		for (const action of ["start", "done", "complete"]) {
			const [current] = await tx<
				{ version: number }[]
			>`select version from public.orders where id = ${placed.id}`;
			await tx`select app.counter_order_act(${placed.id}::uuid, ${action}, ${current?.version ?? 1})`;
		}
	});
	const [stampsBefore] = await db<
		{ stamps: number }[]
	>`select c.stamps from public.stamp_cards c join app.customer_logins l on l.id = c.customer_login_id where l.user_id = ${placed.customer}`;
	expect(stampsBefore?.stamps).toBe(1);

	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${placed.id}`);
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"completed",
	);
	await expect(page.getByTestId("open-refund")).toHaveCount(0);
	const staffTry = await asMember(db, seeded.people.staff.id, async (tx) => {
		const [row] = await tx<
			{ r: { refusal: string } }[]
		>`select app.counter_refund(${placed.id}::uuid, 29000, 'thử') as r`;
		return row?.r.refusal;
	});
	expect(staffTry).toBe("manager_required");

	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const manager = await context.newPage();
	await signIn(manager, seeded.people.manager);
	await manager.goto(`/#/don/${placed.id}`);
	await manager.getByTestId("open-refund").click();
	await manager.getByTestId("refund-reason").fill("Pha sai, khách không nhận");
	await manager.getByTestId("refund-submit").click();
	await expect(manager.getByTestId("payment-status")).toContainText(
		"Đã hoàn tiền",
	);
	await expect(
		manager.getByTestId("audit-line").filter({ hasText: "hoàn tiền" }).last(),
	).toContainText(seeded.people.manager.name);
	await context.close();
	const [stampsAfter] = await db<
		{ stamps: number }[]
	>`select c.stamps from public.stamp_cards c join app.customer_logins l on l.id = c.customer_login_id where l.user_id = ${placed.customer}`;
	expect(stampsAfter?.stamps).toBe(0);
	const reversed =
		await db`select 1 from public.stamp_entries e join public.stamp_cards c on c.id = e.card_id join app.customer_logins l on l.id = c.customer_login_id
		where l.user_id = ${placed.customer} and e.kind = 'order_reversed'`;
	expect(reversed).toHaveLength(1);
});

test("two tablets act on one order: one wins, the other sees the conflict and the new state", async ({
	page,
	browser,
	seeded,
	db,
}) => {
	const placed = await customerOrder(db, seeded, seeded.tables.t1);
	await signIn(page, seeded.people.staff);
	const context = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const other = await context.newPage();
	await signIn(other, seeded.people.staff2);
	await page.goto(`/#/don/${placed.id}`);
	await other.goto(`/#/don/${placed.id}`);
	await expect(other.getByTestId("act-start")).toBeVisible();
	// the second tablet stops hearing about changes, as if its polls were slow
	await other.route(/\/rpc\/(counter_board|counter_order)$/, (route) =>
		route.abort(),
	);
	await page.getByTestId("act-start").click();
	await expect(page.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"preparing",
	);
	// the second tablet, still showing the order as new, cancels it: the database refuses the stale version
	await other.getByTestId("open-cancel").click();
	await other.getByTestId("cancel-reason-store_busy").check();
	await other.getByTestId("cancel-submit").click();
	await other.unroute(/\/rpc\/(counter_board|counter_order)$/);
	await expect(other.getByTestId("toast")).toContainText("cập nhật ở máy khác");
	await expect(other.getByTestId("order-detail")).toHaveAttribute(
		"data-order-status",
		"preparing",
	);
	// the same step pressed again on the second tablet is a replay: no second event
	await other.getByTestId("act-done").waitFor();
	const events = await db<{ action: string }[]>`
		select action from public.order_events where order_id = ${placed.id} and kind = 'status' order by id`;
	expect(events.map((event) => event.action)).toEqual(["placed", "start"]);
	await context.close();
});

test("the network drops: the shown orders stay, and back online the screen says how many arrived", async ({
	page,
	context,
	seeded,
	db,
}) => {
	const first = await customerOrder(db, seeded, seeded.tables.t1);
	await signIn(page, seeded.people.staff);
	await expect(card(page, first.id)).toBeVisible();
	await context.setOffline(true);
	await expect(page.getByTestId("offline-banner")).toBeVisible({
		timeout: 10_000,
	});
	await expect(page.getByTestId("offline-banner")).toContainText(
		"Đang giữ 1 đơn",
	);
	await expect(card(page, first.id)).toBeVisible();
	const second = await customerOrder(db, seeded, seeded.tables.t2);
	const third = await customerOrder(db, seeded, seeded.tables.t3);
	await context.setOffline(false);
	await expect(page.getByTestId("resynced-banner")).toContainText("2 đơn mới", {
		timeout: 15_000,
	});
	await expect(card(page, second.id)).toBeVisible();
	await expect(card(page, third.id)).toBeVisible();
	await expect(card(page, first.id)).toBeVisible();
});

test("security: another store's order is not reachable (IDOR), on screen or through the function", async ({
	page,
	seeded,
	db,
}) => {
	const orderB = await asMember(db, seeded.people.staffB.id, async (tx) => {
		const [row] = await tx<{ r: { order: { id: string } } }[]>`
			select app.counter_create_order(${seeded.storeB}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.bread, qty: 1 }],
			} as never)}::jsonb) as r`;
		return row?.r.order.id ?? "";
	});
	expect(orderB).not.toBe("");
	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${orderB}`);
	await expect(
		page.getByText("Không tìm thấy đơn này ở quán của bạn"),
	).toBeVisible();
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) => tx`select app.counter_order(${orderB}::uuid)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) => tx`select app.counter_board(${seeded.storeB}::uuid, 0)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) => tx`select app.counter_order_act(${orderB}::uuid, 'start', 1)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_record_payment(${orderB}::uuid, 'cash', 25000, 1)`,
		),
	).toBe("42501");
	await nav(page, "orders").click();
	await expect(page.locator(`[data-order-id="${orderB}"]`)).toHaveCount(0);
});
