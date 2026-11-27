import {
	asMember,
	counterToken,
	expect,
	nav,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/shift (Q02, acceptance criteria 6 and 7): clocking in with the counter's QR code and the opening cash,
// a wrong code, a matched clock-out, a short drawer that waits for a manager who confirms it on another device with a
// reason, the day's reconciliation, and the month's worked days equal to the recorded times. Every run starts from no
// open shift for the person (the suite's people are reset at the start of each test).

test.beforeEach(async ({ db, seeded }) => {
	await db`delete from public.staff_shifts where tenant_id = ${seeded.tenantId}`;
});

async function countNotes(
	page: import("@playwright/test").Page,
	prefix: string,
	notes: Record<number, number>,
) {
	for (const [denomination, count] of Object.entries(notes)) {
		await page.getByTestId(`${prefix}-${denomination}`).fill(String(count));
	}
}

test("a wrong counter code is refused and no shift opens", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.staff);
	await nav(page, "shift").click();
	await page.getByTestId("counter-code").fill("A".repeat(22));
	await page.getByTestId("clock-in-submit").click();
	await expect(page.getByTestId("clock-in-message")).toContainText(
		"Mã quầy không đúng",
	);
	const rows =
		await db`select 1 from public.staff_shifts where user_id = ${seeded.people.staff.id}`;
	expect(rows).toHaveLength(0);
});

test("clock in with the counter code and the opening cash, then clock out with a matching blind count", async ({
	page,
	seeded,
	db,
}) => {
	const token = await counterToken(db, seeded);
	await signIn(page, seeded.people.staff);
	await expect(page.getByTestId("shift-chip")).toContainText("Chưa vào ca");
	await page.getByTestId("shift-chip").click();
	await page.getByTestId("counter-code").fill(token);
	await countNotes(page, "opening", { 500000: 2 });
	await expect(page.getByTestId("opening-total")).toContainText("1.000.000đ");
	await page.getByTestId("clock-in-submit").click();
	await expect(page.getByTestId("open-shift")).toBeVisible();
	await expect(page.getByTestId("shift-chip")).toContainText("Ca từ");
	// the count is blind: no expected cash is shown while the shift is open
	await expect(page.getByTestId("open-shift")).not.toContainText("Dự kiến");
	await page.getByTestId("clock-out").click();
	await countNotes(page, "closing", { 500000: 2 });
	await page.getByTestId("clock-out-submit").click();
	await expect(page.getByTestId("toast")).toContainText("Két khớp");
	await expect(page.getByTestId("clock-in")).toBeVisible();
	const [shift] = await db<
		{ status: string; counted_cash: string; expected_cash: string }[]
	>`
		select status, counted_cash::text, expected_cash::text from public.staff_shifts where user_id = ${seeded.people.staff.id}`;
	expect(shift).toEqual({
		status: "closed",
		counted_cash: "1000000.00",
		expected_cash: "1000000.00",
	});
});

test("criterion 6: a short drawer waits for a manager, who confirms it with a reason on another device", async ({
	page,
	browser,
	seeded,
	db,
}) => {
	const token = await counterToken(db, seeded);
	await signIn(page, seeded.people.staff2);
	await nav(page, "shift").click();
	await page.getByTestId("counter-code").fill(token);
	await countNotes(page, "opening", { 500000: 2 });
	await page.getByTestId("clock-in-submit").click();
	await page.getByTestId("clock-out").click();
	await countNotes(page, "closing", { 500000: 1, 200000: 2, 50000: 1 });
	await page.getByTestId("clock-out-submit").click();
	await expect(page.getByTestId("cash-difference")).toContainText("Thiếu tiền");
	await expect(page.getByTestId("cash-difference")).toContainText("50.000đ");
	await expect(page.getByTestId("manager-needed")).toBeVisible();
	await expect(page.getByTestId("shift-chip")).toContainText("Chờ xác nhận");

	const managerContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const manager = await managerContext.newPage();
	await signIn(manager, seeded.people.manager);
	await manager.goto("/#/quan-ly/ca-lam");
	const row = manager
		.getByTestId("shift-row")
		.filter({ hasText: seeded.people.staff2.name });
	await expect(row).toHaveAttribute("data-status", "awaiting_confirmation");
	await row.getByTestId("confirm-shift-open").click();
	await expect(manager.getByTestId("confirm-shift-submit")).toBeDisabled();
	await manager
		.getByTestId("difference-reason")
		.getByRole("button", { name: "Trả nhầm tiền thừa" })
		.click();
	await manager.getByTestId("confirm-note").fill("Khách bàn 2 đi rồi");
	await manager.getByTestId("confirm-shift-submit").click();
	await expect(manager.getByTestId("toast")).toContainText("Đã xác nhận");
	await expect(row).toHaveAttribute("data-status", "closed");
	await expect(manager.getByTestId("reconciliation")).toBeVisible();
	await managerContext.close();

	await expect(page.getByTestId("clock-in")).toBeVisible({ timeout: 20_000 });
	const [shift] = await db<
		{ status: string; close_note: string; closed_by: string }[]
	>`
		select status, close_note, closed_by::text from public.staff_shifts where user_id = ${seeded.people.staff2.id}`;
	expect(shift).toEqual({
		status: "closed",
		close_note: "Trả nhầm tiền thừa · Khách bàn 2 đi rồi",
		closed_by: seeded.people.manager.id,
	});
});

test("security: a manager cannot confirm their own shortage (the database refuses, the screen says so)", async ({
	page,
	seeded,
	db,
}) => {
	const token = await counterToken(db, seeded);
	await signIn(page, seeded.people.manager);
	await nav(page, "shift").click();
	await page.getByTestId("counter-code").fill(token);
	await page.getByTestId("clock-in-submit").click();
	await page.getByTestId("clock-out").click();
	await countNotes(page, "closing", { 1000: 1 });
	await page.getByTestId("clock-out-submit").click();
	await expect(page.getByTestId("cash-difference")).toContainText("Thừa tiền");
	await page.goto("/#/quan-ly/ca-lam");
	const row = page
		.getByTestId("shift-row")
		.filter({ hasText: seeded.people.manager.name });
	await expect(row).toContainText("Ca của bạn");
	await expect(row.getByTestId("confirm-shift-open")).toHaveCount(0);
	const answer = await asMember(db, seeded.people.manager.id, async (tx) => {
		const [shift] = await tx<
			{ id: string }[]
		>`select id from public.staff_shifts where user_id = ${seeded.people.manager.id}`;
		const [row2] = await tx<
			{ r: { refusal: string } }[]
		>`select app.manager_confirm_shift(${shift?.id ?? ""}::uuid, 'self') as r`;
		return row2?.r.refusal;
	});
	expect(answer).toBe("own_shift");
});

test("criterion 7: the month's worked days equal the recorded clock-in and clock-out times", async ({
	page,
	seeded,
	db,
}) => {
	// a full day yesterday (8 hours, a worked day) and a half day the day before (4 hours, half a day)
	await db`insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, clock_out_at, opening_cash, expected_cash, counted_cash, cash_difference, status, closed_at)
		values (${seeded.tenantId}, ${seeded.storeA}, ${seeded.people.staff.id}, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1,
			now() - interval '1 day' - interval '8 hours', now() - interval '1 day', 0, 0, 0, 0, 'closed', now() - interval '1 day'),
		(${seeded.tenantId}, ${seeded.storeA}, ${seeded.people.staff.id}, (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2,
			now() - interval '2 days' - interval '4 hours', now() - interval '2 days', 0, 0, 0, 0, 'closed', now() - interval '2 days')`;
	const [month] = await db<
		{ start: string }[]
	>`select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date - 2, 'YYYY-MM') as start`;
	const [today] = await db<
		{ month: string }[]
	>`select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM') as month`;
	test.skip(
		month?.start !== today?.month,
		"the two days before today are in the previous month",
	);
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/ca-lam");
	const row = page
		.getByTestId("worked-days-row")
		.filter({ hasText: seeded.people.staff.name });
	await expect(row).toContainText("12");
	await expect(row).toContainText("1.5");
	await signIn(page, seeded.people.staff);
	await nav(page, "shift").click();
	await expect(page.getByTestId("worked-days")).toContainText("1.5 / 28");
});
