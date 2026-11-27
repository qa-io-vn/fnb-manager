import { randomUUID } from "node:crypto";
import {
	COFFEE_M,
	callStaff,
	customerUnavailableItems,
	placeCustomerOrder,
	seedCustomer,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	nav,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/tables-menu (S05, the plan's notifications; acceptance criterion 2): a customer's "Gọi nhân viên" turns
// the table red with words and rings, "Tới ngay" answers it with who and when; an item switched sold out at the
// counter is gone from the customer app's menu poll within 5 seconds and back when switched on; pausing app orders
// refuses new ones; staff may not pause beyond an hour.

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
	await db`delete from public.table_calls where tenant_id = ${seeded.tenantId}`;
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
	await db`update public.store_ordering_settings set paused_until = null, paused_reason = null where tenant_id = ${seeded.tenantId}`;
});

test("a staff call turns the table red with words and rings; Tới ngay answers it", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.staff);
	await page.getByTestId("sound-chip").click();
	await nav(page, "tables").click();
	const tile = page.locator('[data-testid="table-tile"][data-table="Bàn 2"]');
	await expect(tile).toHaveAttribute("data-state", "free");
	const before = Number(
		(await page.evaluate(() => document.documentElement.dataset.chimes)) ?? "0",
	);
	const customer = await seedCustomer(db, seeded);
	await callStaff(db, seeded, customer, seeded.tables.t2);
	await expect(tile).toHaveAttribute("data-state", "calling", {
		timeout: 6_000,
	});
	await expect(tile).toContainText("Đang gọi nhân viên");
	await expect(nav(page, "tables")).toContainText("1");
	await expect
		.poll(async () =>
			Number(
				await page.evaluate(
					() => document.documentElement.dataset.chimes ?? "0",
				),
			),
		)
		.toBeGreaterThan(before);
	await tile.getByTestId("ack-call").click();
	await expect(page.getByTestId("toast")).toContainText("Đã nhận lời gọi");
	await expect(tile).not.toHaveAttribute("data-state", "calling");
	const [call] = await db<{ acknowledged_by: string }[]>`
		select acknowledged_by::text from public.table_calls where tenant_id = ${seeded.tenantId} and table_id = ${seeded.tables.t2}`;
	expect(call?.acknowledged_by).toBe(seeded.people.staff.id);
});

test("criterion 2: an item switched sold out disappears from the customer app within 5 seconds, and comes back", async ({
	page,
	seeded,
	db,
}) => {
	const customer = await seedCustomer(db, seeded);
	expect(await customerUnavailableItems(db, seeded, customer)).not.toContain(
		seeded.items.tea,
	);
	await signIn(page, seeded.people.staff);
	await nav(page, "menu").click();
	const row = page.locator('[data-testid="menu-row"][data-item="Trà đào"]');
	await row.getByTestId("sold-out-switch").click();
	const switched = Date.now();
	await expect(page.getByTestId("toast")).toContainText("Đã báo hết Trà đào");
	await expect
		.poll(() => customerUnavailableItems(db, seeded, customer), {
			timeout: 5_000,
		})
		.toContain(seeded.items.tea);
	expect(Date.now() - switched).toBeLessThan(5_000);
	await expect(row).toContainText("Tạm hết đến");
	// the customer app refuses a basket with the sold-out item
	const refused = await placeCustomerOrder(db, seeded, customer, {
		table: seeded.tables.t1,
		lines: [{ size: seeded.sizes.tea, qty: 1 }],
		expectedTotal: 39_000,
	}).catch(() => ({ state: "error", order: null }));
	expect(refused.state).toBe("refused");
	await row.getByTestId("sold-out-switch").click();
	await expect
		.poll(() => customerUnavailableItems(db, seeded, customer), {
			timeout: 5_000,
		})
		.not.toContain(seeded.items.tea);
});

test("pausing app orders refuses new ones until the counter resumes", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.staff);
	await nav(page, "menu").click();
	await page.getByTestId("pause-15").click();
	await expect(page.getByTestId("paused-note")).toContainText("tạm ngừng đến");
	const customer = await seedCustomer(db, seeded);
	const refused = await placeCustomerOrder(db, seeded, customer, {
		table: seeded.tables.t1,
		lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
		expectedTotal: COFFEE_M,
	}).catch(() => ({ state: "error", order: null }));
	expect(refused.state).toBe("refused");
	await nav(page, "orders").click();
	await expect(page.getByTestId("ordering-closed")).toContainText("tạm ngừng");
	await nav(page, "menu").click();
	await page.getByTestId("resume").click();
	await expect(page.getByTestId("pause-15")).toBeVisible();
	const placed = await placeCustomerOrder(db, seeded, customer, {
		table: seeded.tables.t1,
		lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
		expectedTotal: COFFEE_M,
	});
	expect(placed.state).toBe("placed");
});

test("security: staff may pause an hour at most, and only at their own store", async ({
	seeded,
	db,
}) => {
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_set_pause(${seeded.storeA}::uuid, 61, null)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_set_pause(${seeded.storeA}::uuid, 60, null)`,
		),
	).toBe("ok");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_set_pause(${seeded.storeB}::uuid, 15, null)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_set_sold_out(${seeded.storeB}::uuid, ${seeded.items.tea}::uuid, true)`,
		),
	).toBe("42501");
	expect(
		await asMember(db, seeded.people.manager.id, async (tx) => {
			const [row] = await tx<
				{ r: { paused_until: string } }[]
			>`select app.counter_set_pause(${seeded.storeA}::uuid, 120, ${`thử ${randomUUID().slice(0, 4)}`}) as r`;
			return row?.r.paused_until !== null;
		}),
	).toBe(true);
});
