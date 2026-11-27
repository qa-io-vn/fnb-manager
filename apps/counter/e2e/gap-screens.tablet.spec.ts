import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
	COFFEE_M,
	issueStampCode,
	seedJoinedCustomer,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	nav,
	openShiftFor,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/gap-screens (native-till.md section 18 wired into the counter, 2026-11-28):
// - Q01 stamps (use case, decision table): with a member on the ticket, the ticket says how many stamps the order earns
//   (the units of the lines that count), nothing for pastries only and nothing while the brand's card is off; the
//   member dialog says it too;
// - Q02 "Đối chiếu" (state transitions, security): while the shift is open nothing asks for the breakdown (no request
//   at all: the count stays blind); after a short count the breakdown, asked only after the count was sent, states the
//   cash sale, the card payment outside the drawer, the expected and counted cash and the difference; a matching count
//   closes the shift and shows its breakdown until dismissed; a past shift's breakdown opens from Ca gần đây;
// - Q03 (error guessing): a manager off shift is refused a cash refund in words with "Vào ca", which opens Ca làm;
//   nothing is refunded.

type Db = Parameters<typeof seedJoinedCustomer>[0];
type Seeded = Parameters<typeof seedJoinedCustomer>[1];

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
	await db`delete from public.staff_shifts where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.stamp_card_settings where tenant_id = ${seeded.tenantId}`;
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
});

test.afterEach(async ({ db, seeded }) => {
	await db`delete from public.stamp_card_settings where tenant_id = ${seeded.tenantId}`;
});

function tile(page: Page, name: string) {
	return page.locator(`[data-testid="menu-tile"][data-item="${name}"]`);
}

async function memberNumber(db: Db, seeded: Seeded): Promise<string> {
	// one phone per run: the projects share the seeded tenant, and a phone is unique in it
	const phone = `09${String(Date.now()).slice(-8)}`;
	const joined = await seedJoinedCustomer(db, seeded, "Lê Văn Mẫu", phone);
	const answer = (await issueStampCode(db, seeded, joined)) as {
		state: string;
		code: { number: string };
	};
	expect(answer.state).toBe("issued");
	return answer.code.number;
}

async function attachOnTicket(page: Page, number: string): Promise<void> {
	await page.getByTestId("ticket-member-scan").click();
	const dialog = page.getByTestId("member-dialog");
	await dialog.getByTestId("member-number").fill(number);
	await dialog.getByTestId("member-check").click();
	await expect(dialog.getByTestId("member-name")).toHaveText(
		"Đọc được mã: Mẫu",
	);
}

/** A counter order of two coffees paid at once by the person (on shift), by cash or card. */
async function paidCounterOrder(
	db: Db,
	seeded: Seeded,
	userId: string,
	method: "cash" | "card",
	complete = false,
): Promise<string> {
	return await asMember(db, userId, async (tx) => {
		const [created] = await tx<
			{ r: { order: { id: string; version: number } } }[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.coffeeM, qty: 2 }],
			} as never)}::jsonb) as r`;
		const id = created?.r.order.id ?? "";
		await tx`select app.counter_record_payment(${id}::uuid, ${method}, ${2 * COFFEE_M}, ${created?.r.order.version ?? 1})`;
		if (complete)
			for (const action of ["start", "done", "complete"]) {
				const [current] = await tx<
					{ version: number }[]
				>`select version from public.orders where id = ${id}`;
				await tx`select app.counter_order_act(${id}::uuid, ${action}, ${current?.version ?? 1})`;
			}
		return id;
	});
}

test("Q01: the ticket says how many stamps the order earns its member, nothing for pastries only", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	const number = await memberNumber(db, seeded);
	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page.getByTestId("type-takeaway").click();
	// pastries only: the member is attached, nothing to earn is said
	await tile(page, "Bánh chuối").click();
	await attachOnTicket(page, number);
	await expect(page.getByTestId("member-stamps")).not.toContainText("ly nước");
	await page.getByTestId("member-attach").click();
	await expect(page.getByTestId("ticket-member-name")).toContainText("Mẫu");
	await expect(page.getByTestId("ticket-member-earn")).toHaveCount(0);
	// a drink: one stamp; the same drink again: two; the pastry still counts for nothing
	await tile(page, "Trà đào").click();
	await expect(page.getByTestId("ticket-member-earn")).toHaveText(
		"Đơn này cộng thêm 1 dấu khi hoàn thành.",
	);
	await tile(page, "Trà đào").click();
	await expect(page.getByTestId("ticket-member-earn")).toHaveText(
		"Đơn này cộng thêm 2 dấu khi hoàn thành.",
	);
	await expectNoHorizontalScroll(page);
	// the member dialog of a ticket with drinks says it as well
	await page.getByTestId("ticket-member-remove").click();
	await attachOnTicket(page, number);
	await expect(page.getByTestId("member-stamps")).toContainText(
		"Đơn này có 2 ly nước, cộng 2 dấu khi đơn hoàn thành.",
	);
	await page.getByTestId("member-attach").click();
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-quick-103000").click();
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("create-done")).toBeVisible();
	// the ticket's number is the server's: the order's lines that count for stamps hold 2 units
	const [order] = await db<{ attached: boolean; units: number }[]>`
		select o.member_login_id is not null as attached,
			(select coalesce(sum(l.quantity) filter (where l.counts_for_stamps), 0)::int from public.order_lines l where l.order_id = o.id) as units
		from public.orders o where o.tenant_id = ${seeded.tenantId} and o.source = 'counter'`;
	expect(order).toEqual({ attached: true, units: 2 });
});

test("Q01: nothing to earn is said while the brand's stamp card is off", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	// the code is issued while the card is on (an app gets none while it is off), then the brand switches it off
	const number = await memberNumber(db, seeded);
	await db`insert into public.stamp_card_settings (tenant_id, brand_id, enabled, stamps_per_reward)
		values (${seeded.tenantId}, ${seeded.brandId}, false, 9)`;
	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page.getByTestId("type-takeaway").click();
	await tile(page, "Trà đào").click();
	await attachOnTicket(page, number);
	await expect(page.getByTestId("member-stamps")).not.toContainText("ly nước");
	await page.getByTestId("member-attach").click();
	await expect(page.getByTestId("ticket-member-name")).toContainText("Mẫu");
	await expect(page.getByTestId("ticket-member-earn")).toHaveCount(0);
});

test("Q02: nothing asks for Đối chiếu while the shift is open; after a short count it breaks the drawer down", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await paidCounterOrder(db, seeded, seeded.people.staff.id, "cash");
	await paidCounterOrder(db, seeded, seeded.people.staff.id, "card");
	const calls: string[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (url.includes("/rpc/staff_shift_reconciliation"))
			calls.push("reconciliation");
		if (url.includes("/rpc/staff_clock_out")) calls.push("clock_out");
	});
	await signIn(page, seeded.people.staff);
	await nav(page, "shift").click();
	const open = page.getByTestId("open-shift");
	await expect(open).toBeVisible();
	await expect(open).not.toContainText("Đối chiếu");
	await expect(open).not.toContainText("Dự kiến");
	await page.getByTestId("clock-out").click();
	await expect(page.getByTestId("reconciliation-view")).toHaveCount(0);
	// the blind count: not one request for the breakdown before the count is sent
	expect(calls).toEqual([]);
	await page.getByTestId("closing-50000").fill("1");
	const answered = page.waitForResponse((response) =>
		response.url().includes("/rpc/staff_shift_reconciliation"),
	);
	await page.getByTestId("clock-out-submit").click();
	const view = page.getByTestId("reconciliation-view");
	await expect(view).toBeVisible();
	expect(calls[0]).toBe("clock_out");
	expect(calls).toContain("reconciliation");
	const body = (await (await answered).json()) as { state: string };
	expect(body.state).toBe("ok");
	await expect(page.getByTestId("recon-cashSales")).toContainText(
		"Thu tiền mặt · 1 đơn",
	);
	await expect(page.getByTestId("recon-cashSales")).toContainText("+58.000đ");
	await expect(page.getByTestId("recon-cashRefunds")).toContainText(
		"Hoàn tiền mặt · 0 đơn",
	);
	await expect(page.getByTestId("recon-paidOuts")).toContainText(
		"Chi từ két · 0 khoản",
	);
	await expect(page.getByTestId("recon-expected")).toContainText("58.000đ");
	await expect(page.getByTestId("recon-counted")).toContainText("50.000đ");
	const difference = page.getByTestId("cash-difference");
	await expect(difference).toContainText("Thiếu tiền");
	await expect(difference).toContainText("−8.000đ");
	await expect(page.getByTestId("recon-card")).toContainText(
		"Thẻ tại quầy · 1 đơn",
	);
	await expect(page.getByTestId("recon-card")).toContainText("58.000đ");
	await expect(page.getByTestId("recon-outside")).toContainText(
		"Đối chiếu với cổng thanh toán ở báo cáo ngày.",
	);
	await expect(page.getByTestId("reason-step")).toBeVisible();
	await expectNoHorizontalScroll(page);
});

test("Q02: a matching count closes the shift and shows its Đối chiếu until dismissed; Ca gần đây opens it again", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff2.id);
	await signIn(page, seeded.people.staff2);
	await nav(page, "shift").click();
	await page.getByTestId("clock-out").click();
	await page.getByTestId("clock-out-submit").click();
	await expect(page.getByTestId("toast")).toContainText("Két khớp");
	const closed = page.getByTestId("closed-shift");
	await expect(closed).toBeVisible();
	await expect(closed).toContainText("Đã ra ca · đối chiếu");
	await expect(closed.getByTestId("cash-difference")).toContainText("Khớp");
	await expect(closed.getByTestId("cash-difference")).toContainText(
		"Đã đếm bằng số dự kiến",
	);
	await expect(page.getByTestId("clock-in")).toBeVisible();
	await expectNoHorizontalScroll(page);
	await page.getByTestId("closed-shift-dismiss").click();
	await expect(closed).toHaveCount(0);
	await page.getByTestId("recent-reconciliation").first().click();
	const dialog = page.getByTestId("reconciliation-dialog");
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId("cash-difference")).toContainText("Khớp");
	await dialog.getByRole("button", { name: "Đóng" }).click();
	await expect(dialog).toHaveCount(0);
});

test("Q03: a manager off shift is refused a cash refund in words, and Vào ca leads to Ca làm; nothing is refunded", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	const id = await paidCounterOrder(
		db,
		seeded,
		seeded.people.staff.id,
		"cash",
		true,
	);
	await signIn(page, seeded.people.manager);
	await page.goto(`/#/don/${id}`);
	await page.getByTestId("open-refund").click();
	await page.getByTestId("refund-reason").fill("Pha sai, khách không nhận");
	await page.getByTestId("refund-submit").click();
	const notice = page.getByTestId("refund-need-shift");
	await expect(notice).toContainText(
		"Bạn chưa vào ca ở quầy này. Vào ca rồi hoàn tiền mặt.",
	);
	await expect(notice).toHaveAttribute("role", "alert");
	await page.getByTestId("refund-go-shift").click();
	await expect(page).toHaveURL(/#\/ca$/);
	await expect(page.getByTestId("clock-in")).toBeVisible();
	const [order] = await db<{ payment_status: string; refunds: number }[]>`
		select o.payment_status::text, (select count(*)::int from public.order_refunds r where r.order_id = o.id) as refunds
		from public.orders o where o.id = ${id}`;
	expect(order).toEqual({ payment_status: "paid", refunds: 0 });
});
