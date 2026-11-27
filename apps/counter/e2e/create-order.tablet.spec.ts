import { randomUUID } from "node:crypto";
import {
	asMember,
	clearQueue,
	expect,
	openShiftFor,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/create-order (Q01; Q01-U1, I1, I7, S2): a walk-in order keyed at the counter with sizes and options, cash
// with the change, the order in the queue and the 80 mm ticket printed; a sold-out item cannot be tapped; the client
// can neither lower a price nor send one.

test.beforeEach(async ({ db, seeded, page }) => {
	await clearQueue(db, seeded);
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await page.addInitScript(() => {
		window.print = () => {
			const scope = window as unknown as { printed?: number };
			scope.printed = (scope.printed ?? 0) + 1;
		};
	});
});

test("a walk-in order: options, cash with change, the queue and the printed ticket", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Cà phê sữa"]')
		.click();
	await page.getByTestId("size-Lớn").check({ force: true });
	await page.getByTestId("option-Ít đá").click();
	await expect(page.getByTestId("options-add")).toContainText("35.000đ");
	await page.getByTestId("options-add").click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Bánh chuối"]')
		.click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Bánh chuối"]')
		.click();
	await expect(
		page.locator(
			'[data-testid="menu-tile"][data-item="Bánh chuối"] [data-testid="tile-count"]',
		),
	).toHaveText("×2");
	await expect(page.getByTestId("ticket-total")).toContainText("85.000đ");
	await expect(page.getByTestId("create-pay")).toBeDisabled();
	await page
		.getByTestId("create-table")
		.selectOption({ label: "Bàn 3 · Tầng 1" });
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-given").fill("100.000");
	await expect(page.getByTestId("pay-change")).toContainText("15.000đ");
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("create-done")).toBeVisible();
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { printed?: number }).printed ?? 0,
			),
		)
		.toBe(1);
	const ticket = page.getByTestId("print-ticket-view");
	await expect(ticket).toContainText("Bàn 3");
	await expect(ticket).toContainText("2× Bánh chuối");
	await expect(ticket).toContainText("Lớn · Ít đá");
	await expect(ticket).toContainText("85.000đ");
	await page.emulateMedia({ media: "print" });
	await expect(ticket).toBeVisible();
	await expect(page.getByTestId("ticket")).toBeHidden();
	await page.emulateMedia({ media: "screen" });
	await page.getByTestId("reprint").click();
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { printed?: number }).printed ?? 0,
			),
		)
		.toBe(2);
	await page.getByTestId("create-next").click();
	await expect(page.getByTestId("ticket-total")).toContainText("0đ");

	const [order] = await db<
		{
			source: string;
			total: string;
			payment_status: string;
			status: string;
			table_label: string;
		}[]
	>`
		select source, total::text, payment_status::text, status::text, table_label from public.orders where tenant_id = ${seeded.tenantId}`;
	expect(order).toEqual({
		source: "counter",
		total: "85000.00",
		payment_status: "paid",
		status: "accepted",
		table_label: "Bàn 3",
	});
	await page.goto("/#/don");
	await expect(
		page.getByTestId("order-card").filter({ hasText: "Bàn 3" }),
	).toBeVisible();
});

test("a sold-out item cannot be tapped; a takeaway order needs no table", async ({
	page,
	seeded,
	db,
}) => {
	await asMember(
		db,
		seeded.people.staff.id,
		(tx) =>
			tx`select app.counter_set_sold_out(${seeded.storeA}::uuid, ${seeded.items.tea}::uuid, true)`,
	);
	await signIn(page, seeded.people.staff);
	await page.goto("/#/tao-don");
	await expect(
		page.locator('[data-testid="menu-tile"][data-item="Trà đào"]'),
	).toBeDisabled();
	await expect(
		page.locator('[data-testid="menu-tile"][data-item="Trà đào"]'),
	).toContainText("Tạm hết");
	await page.getByTestId("type-takeaway").click();
	await page
		.locator('[data-testid="menu-tile"][data-item="Bánh chuối"]')
		.click();
	await expect(page.getByTestId("create-pay")).toBeEnabled();
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-card").click();
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("create-done")).toBeVisible();
	const [order] = await db<{ order_type: string; payment_method: string }[]>`
		select o.order_type::text, p.method as payment_method from public.orders o join public.order_payments p on p.order_id = o.id
		where o.tenant_id = ${seeded.tenantId}`;
	expect(order).toEqual({ order_type: "takeaway", payment_method: "card" });
});

test("security: the server prices the order; a lower total is refused and a price in a line is malformed", async ({
	seeded,
	db,
}) => {
	const lowered = await asMember(db, seeded.people.staff.id, async (tx) => {
		const [row] = await tx<
			{ r: { state: string; refusal: string; total: number } }[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.coffeeL, qty: 1 }],
				expected_total: 1_000,
			} as never)}::jsonb) as r`;
		return row?.r;
	});
	expect(lowered).toMatchObject({
		state: "refused",
		refusal: "price_changed",
		total: 35_000,
	});
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
					request_id: randomUUID(),
					type: "takeaway",
					lines: [{ size: seeded.sizes.coffeeL, qty: 1, price: 1 }],
				} as never)}::jsonb)`,
		),
	).toBe("22023");
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) =>
				tx`select app.counter_record_payment(gen_random_uuid(), 'cash', 1, 1)`,
		),
	).toBe("42501");
});
