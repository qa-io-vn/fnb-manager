import { randomUUID } from "node:crypto";
import { vietnamInstant } from "../src/manager/requests";
import {
	asCustomer,
	COFFEE_M,
	seedCustomer,
	submitBooking,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	nav,
	openShiftFor,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/gap-screens on a manager's phone (native-till.md section 18):
// - M01 (state transitions proposed → confirmed·accepted_unseen → seen): a customer accepted the time proposed in the
//   app; the manager's tab, Quản lý and the inbox count it with the unread ones, the inbox lists it with its own mark
//   and words in "Chưa xử lý"; opening it records who saw it and it moves to "Đã xử lý"; the first reader is kept;
// - Q02 from Quản lý → Ca làm: a manager opens another person's open shift's "Đối chiếu" (the figures so far, not
//   counted), never their own open shift's (the button is not there, the server says count_required);
// - security: staff cannot read the inbox or clear the flag, nor read another person's breakdown (42501).

const HOUR = 3_600_000;

function tomorrowAt(clock: string): string {
	const day = new Date(Date.now() + 24 * HOUR + 7 * HOUR)
		.toISOString()
		.slice(0, 10);
	return vietnamInstant(day, clock) ?? "";
}

test.beforeEach(async ({ db, seeded }) => {
	// the orders go too: a shift's breakdown counts the payments the person recorded in its window
	await clearQueue(db, seeded);
	await db`delete from public.store_requests where tenant_id = ${seeded.tenantId}`;
	await db`delete from public.staff_shifts where tenant_id = ${seeded.tenantId}`;
});

test("M01: a customer's acceptance is counted, listed and marked until the manager opens it", async ({
	page,
	seeded,
	db,
}) => {
	const customer = await seedCustomer(db, seeded);
	const booking = await submitBooking(
		db,
		seeded,
		customer,
		tomorrowAt("19:00"),
	);
	// the owner read it first, then the manager proposed 19:30 on another device
	await asMember(db, seeded.people.owner.id, async (tx) => {
		await tx`select public.manager_request_read(${booking.id}::uuid)`;
	});
	await asMember(db, seeded.people.manager.id, async (tx) => {
		await tx`select public.manager_answer_request(${booking.id}::uuid, 'proposed', 'Giờ đó kín bàn, quán còn chỗ lúc 19:30.', ${booking.version}, ${tomorrowAt("19:30")}::timestamptz)`;
	});
	const accepted = await asCustomer(db, seeded, customer, async (tx) => {
		const [row] = await tx<{ r: { state: string } }[]>`
			select public.customer_accept_proposal(${booking.id}::uuid, ${randomUUID()}::uuid) as r`;
		return row?.r.state;
	});
	expect(accepted).toBe("accepted");
	// security: staff can neither read the inbox nor clear the flag
	expect(
		await refusalOf(
			db,
			seeded.people.staff.id,
			(tx) => tx`select public.manager_request_read(${booking.id}::uuid)`,
		),
	).toBe("42501");

	await signIn(page, seeded.people.manager);
	await expect(nav(page, "manager")).toContainText("1");
	await nav(page, "manager").click();
	await expect(page.getByTestId("manager-requests-unread")).toHaveText(
		"1 chưa đọc",
	);
	await page.getByTestId("manager-requests").click();
	await expect(page.getByTestId("requests-unread")).toHaveText("1 chưa đọc");
	await expect(page.getByTestId("requests-accepted")).toHaveText(
		"1 khách đồng ý giờ mới",
	);
	const row = page.getByTestId("request-row").first();
	await expect(row).toHaveAttribute("data-status", "confirmed");
	await expect(row).toHaveAttribute("data-accepted-unseen", "true");
	await expect(row).toContainText("Khách đồng ý giờ mới");
	await expect(row).toContainText("19:30");
	await expect(row.getByTestId("request-accepted-unseen")).toHaveText(
		"khách đã đồng ý giờ mới, chưa xem",
	);
	await expectNoHorizontalScroll(page);

	await row.click();
	const dialog = page.getByTestId("request-dialog");
	await expect(dialog.getByTestId("request-customer-accepted")).toContainText(
		"Khách đã đồng ý giờ mới trong ứng dụng lúc",
	);
	await expect
		.poll(async () => {
			const [seen] = await db<{ accept_seen_by: string | null }[]>`
				select accept_seen_by::text from public.store_requests where id = ${booking.id}`;
			return seen?.accept_seen_by ?? null;
		})
		.toBe(seeded.people.manager.id);
	await dialog.getByRole("button", { name: "Đóng" }).first().click();
	await expect(page.getByTestId("requests-unread")).toHaveText("0 chưa đọc");
	await expect(page.getByTestId("requests-accepted")).toHaveCount(0);
	await expect(page.getByTestId("request-row")).toHaveCount(0);
	await page
		.getByTestId("request-states")
		.getByRole("button", { name: "Đã xử lý" })
		.click();
	await expect(page.getByTestId("request-row").first()).toHaveAttribute(
		"data-accepted-unseen",
		"false",
	);
	// the first reading of the contact (the owner's) is kept; the manager is who saw the acceptance
	const [kept] = await db<{ read_by: string; accept_seen_by: string }[]>`
		select read_by::text, accept_seen_by::text from public.store_requests where id = ${booking.id}`;
	expect(kept).toEqual({
		read_by: seeded.people.owner.id,
		accept_seen_by: seeded.people.manager.id,
	});
});

test("Q02: a manager opens another person's open shift's Đối chiếu, never their own open one", {
	tag: ["@criterion-6"],
}, async ({ page, seeded, db }) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await openShiftFor(db, seeded, seeded.people.manager.id);
	await asMember(db, seeded.people.staff.id, async (tx) => {
		const [created] = await tx<
			{ r: { order: { id: string; version: number } } }[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.coffeeM, qty: 1 }],
			} as never)}::jsonb) as r`;
		await tx`select app.counter_record_payment(${created?.r.order.id ?? ""}::uuid, 'cash', ${COFFEE_M}, ${created?.r.order.version ?? 1})`;
	});
	const [staffShift] = await db<{ id: string }[]>`
		select id::text from public.staff_shifts where user_id = ${seeded.people.staff.id} and status = 'open'`;
	// security: another staff member of the store cannot read it
	expect(
		await refusalOf(
			db,
			seeded.people.staff2.id,
			(tx) =>
				tx`select public.staff_shift_reconciliation(${staffShift?.id ?? ""}::uuid)`,
		),
	).toBe("42501");

	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/ca-lam");
	const theirs = page
		.getByTestId("shift-row")
		.filter({ hasText: seeded.people.staff.name });
	const mine = page
		.getByTestId("shift-row")
		.filter({ hasText: seeded.people.manager.name });
	await expect(theirs).toHaveAttribute("data-status", "open");
	await expect(mine).toHaveAttribute("data-status", "open");
	await expect(mine.getByTestId("shift-reconciliation-open")).toHaveCount(0);
	await theirs.getByTestId("shift-reconciliation-open").click();
	const dialog = page.getByTestId("reconciliation-dialog");
	await expect(dialog).toContainText(seeded.people.staff.name);
	await expect(dialog.getByTestId("recon-so-far")).toContainText("Ca còn mở");
	await expect(dialog).toContainText("Dự kiến đến giờ");
	await expect(dialog).toContainText("Chưa đếm");
	await expect(dialog.getByTestId("recon-cashSales")).toContainText(
		"Thu tiền mặt · 1 đơn",
	);
	await expect(dialog.getByTestId("recon-expected")).toContainText("29.000đ");
	await expect(dialog.getByTestId("cash-difference")).toHaveCount(0);
	await expectNoHorizontalScroll(page);
	// the manager's own open shift: the server keeps it blind too
	const own = await asMember(db, seeded.people.manager.id, async (tx) => {
		const [row] = await tx<{ r: { refusal: string; reconciliation: null } }[]>`
			select public.staff_shift_reconciliation(s.id) as r from public.staff_shifts s
			where s.user_id = ${seeded.people.manager.id} and s.status = 'open'`;
		return row?.r;
	});
	expect(own).toMatchObject({
		refusal: "count_required",
		reconciliation: null,
	});
});
