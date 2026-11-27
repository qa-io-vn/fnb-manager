import { randomUUID } from "node:crypto";
import { COFFEE_M } from "../test/support/seed";
import {
	asMember,
	chooseZaloPerson,
	clearQueue,
	expect,
	expectNoHorizontalScroll,
	nav,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/manager (M01, M02, the manager pages on a phone; acceptance criterion 5): a person blocked at sign-in is
// added by a manager from the phone, pairs with the code and gets in, then is locked and thrown out of the tablet; the
// requests inbox answers a booking with a reply to copy; the owner changes a price and the log names them; the day's
// overview counts a completed order; the QR codes are there to print; staff reach no manager page or function.

test("criterion 5 end to end: blocked, added from the phone, paired, then locked and thrown out", async ({
	page,
	browser,
	seeded,
}) => {
	const stranger = {
		zaloId: `${seeded.slug}-m02-${randomUUID().slice(0, 8)}`,
		name: "Người mới M02",
	};
	const tabletContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const tablet = await tabletContext.newPage();
	await chooseZaloPerson(tablet, stranger);
	await tablet.goto("/");
	await tablet.getByTestId("sign-in-zalo").click();
	await expect(tablet.getByTestId("blocked")).toBeVisible();

	await signIn(page, seeded.people.manager);
	await nav(page, "manager").click();
	await page.getByTestId("manager-staff").click();
	const row = page
		.getByTestId("blocked-row")
		.filter({ hasText: stranger.name });
	await expect(row).toBeVisible();
	await expectNoHorizontalScroll(page);
	await row.getByTestId("blocked-add").click();
	await expect(page.getByTestId("person-name")).toHaveValue(stranger.name);
	await page.getByTestId("person-save").click();
	const code =
		(await page.getByTestId("pairing-code-value").textContent())?.trim() ?? "";
	expect(code).toMatch(/^[0-9]{6}$/);
	await page
		.getByTestId("pairing-code-dialog")
		.getByRole("button", { name: "Đóng" })
		.click();
	await expect(
		page.getByTestId("roster-row").filter({ hasText: stranger.name }),
	).toHaveAttribute("data-status", "invited");

	await tablet.getByTestId("blocked-back").click();
	await tablet.getByTestId("sign-in-zalo").click();
	await tablet.getByTestId("pairing-code").fill(code);
	await tablet.getByTestId("notice-accept").check();
	await tablet.getByTestId("pair-submit").click();
	await expect(tablet.getByTestId("account")).toContainText(stranger.name);

	await page.reload();
	const person = page
		.getByTestId("roster-row")
		.filter({ hasText: stranger.name });
	await expect(person).toHaveAttribute("data-status", "active");
	await person.getByTestId("lock").click();
	await page.getByTestId("lock-confirm").click();
	await expect(person).toHaveAttribute("data-status", "inactive");
	// the tablet's next poll is refused: the person is signed out at once
	await expect(tablet.getByTestId("sign-in-error")).toContainText("khóa", {
		timeout: 15_000,
	});
	await tabletContext.close();

	await person.getByTestId("unlock").click();
	await expect(page.getByTestId("pairing-code-value")).toHaveText(/^[0-9]{6}$/);
});

test("M01: a booking from the website is answered with a reply to copy, and the timer stops", async ({
	page,
	seeded,
	db,
}) => {
	await db`delete from public.store_requests where tenant_id = ${seeded.tenantId}`;
	const at = new Date(Date.now() + 26 * 3_600_000).toISOString();
	const [submitted] = await db<{ r: { state: string } }[]>`
		select app.web_submit_request(${seeded.brandId}::uuid, ${`synthetic-client-${randomUUID()}`}, ${db.json(
			{
				request_id: randomUUID(),
				store: seeded.storeCodeA,
				kind: "booking",
				name: "Khách Đặt Bàn",
				phone: "0900000001",
				party_size: 4,
				at,
			} as never,
		)}::jsonb, now()) as r`;
	expect(submitted?.r.state).toBe("submitted");
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/yeu-cau");
	await expect(page.getByTestId("requests-summary")).toContainText(
		"1 chưa xử lý",
	);
	await page
		.getByTestId("request-row")
		.filter({ hasText: "Khách Đặt Bàn" })
		.click();
	await page.getByTestId("answer-confirmed").click();
	await page.getByTestId("answer-submit").click();
	await expect(page.getByTestId("reply-text")).toContainText("Khách Đặt Bàn");
	await expect(page.getByTestId("reply-text")).toContainText("4 người");
	await expectNoHorizontalScroll(page);
	const [row] = await db<{ status: string; answered_by: string }[]>`
		select status, answered_by::text from public.store_requests where tenant_id = ${seeded.tenantId}`;
	expect(row).toEqual({
		status: "confirmed",
		answered_by: seeded.people.manager.id,
	});
});

test("the owner changes a price; the log names them; a store manager is refused by the brand rule", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.owner);
	await page.goto("/#/quan-ly/thuc-don");
	const item = page.locator(
		'[data-testid="edit-item"][data-item="Cà phê sữa"]',
	);
	await item.getByTestId("price-input").first().fill("30000");
	await item.getByTestId("price-save").first().click();
	await expect(page.getByTestId("toast")).toContainText("30.000đ");
	await expect(page.getByTestId("price-log-line").first()).toContainText(
		"29.000đ → 30.000đ",
	);
	await expect(page.getByTestId("price-log-line").first()).toContainText(
		seeded.people.owner.name,
	);
	const [change] = await db<{ changed_by: string }[]>`
		select changed_by::text from public.menu_price_changes where brand_id = ${seeded.brandId} order by id desc limit 1`;
	expect(change?.changed_by).toBe(seeded.people.owner.id);
	await item.getByTestId("price-input").first().fill(String(COFFEE_M));
	await item.getByTestId("price-save").first().click();
	await expect(page.getByTestId("price-log-line").first()).toContainText(
		"30.000đ → 29.000đ",
	);

	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/thuc-don");
	await page
		.locator('[data-testid="edit-item"][data-item="Trà đào"]')
		.getByTestId("price-input")
		.fill("41000");
	await page
		.locator('[data-testid="edit-item"][data-item="Trà đào"]')
		.getByTestId("price-save")
		.click();
	await expect(page.getByTestId("menu-edit-message")).toContainText("mọi quán");
	const [tea] = await db<
		{ price: string }[]
	>`select price::text from public.menu_item_sizes where id = ${seeded.sizes.tea}`;
	expect(tea?.price).toBe("39000.00");
});

test("the day's overview counts a completed order and its items", async ({
	page,
	seeded,
	db,
}) => {
	await clearQueue(db, seeded);
	await asMember(db, seeded.people.staff.id, async (tx) => {
		const [created] = await tx<
			{ r: { order: { id: string; version: number } } }[]
		>`
			select app.counter_create_order(${seeded.storeA}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size: seeded.sizes.tea, qty: 2 }],
			} as never)}::jsonb) as r`;
		const id = created?.r.order.id ?? "";
		await tx`select app.counter_record_payment(${id}::uuid, 'card', 78000, ${created?.r.order.version ?? 1})`;
		for (const action of ["start", "done", "complete"]) {
			const [current] = await tx<
				{ version: number }[]
			>`select version from public.orders where id = ${id}`;
			await tx`select app.counter_order_act(${id}::uuid, ${action}, ${current?.version ?? 1})`;
		}
	});
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/tong-quan");
	await expect(page.getByTestId("overview-orders")).toHaveText(/^[1-9][0-9]*$/);
	await expect(page.getByTestId("overview-best")).toContainText("Trà đào");
	await expectNoHorizontalScroll(page);
});

test("the counter's QR code and the tables' codes are there to print", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.manager);
	await page.goto("/#/quan-ly/ma-qr");
	const token = await asMember(db, seeded.people.manager.id, async (tx) => {
		const [row] = await tx<
			{ token: string }[]
		>`select app.manager_counter_qr(${seeded.storeA}::uuid, false) ->> 'token' as token`;
		return row?.token ?? "";
	});
	await expect(page.getByTestId("counter-qr-token")).toHaveText(token);
	await expect(page.getByTestId("counter-qr-code")).toHaveAttribute(
		"data-payload",
		new RegExp(`ma=${token}$`),
	);
	await expect(page.getByTestId("table-qr")).toHaveCount(3);
	await expectNoHorizontalScroll(page);
});

test("security: staff reach no manager page and no manager function", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.staff);
	await expect(nav(page, "manager")).toHaveCount(0);
	for (const path of [
		"/#/quan-ly/nhan-su",
		"/#/quan-ly/yeu-cau",
		"/#/quan-ly/thuc-don",
	]) {
		await page.goto(path);
		await expect(page.getByTestId("managers-only")).toBeVisible();
	}
	const staff = seeded.people.staff.id;
	expect(
		await refusalOf(
			db,
			staff,
			(tx) => tx`select app.manager_requests(${seeded.storeA}::uuid, null, 50)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) =>
				tx`select public.manager_blocked_signins(${seeded.tenantId}::uuid)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) =>
				tx`select app.manager_shifts(${seeded.storeA}::uuid, current_date - 1, current_date)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) => tx`select app.manager_counter_qr(${seeded.storeA}::uuid, false)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) =>
				tx`select app.manager_day_reconciliation(${seeded.storeA}::uuid, current_date)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			staff,
			(tx) =>
				tx`select app.add_staff(${seeded.tenantId}::uuid, 'X', 'staff', null)`,
		),
	).toBe("42501");
	// a store manager reads nothing of another store (IDOR)
	expect(
		await refusalOf(
			db,
			seeded.people.manager.id,
			(tx) => tx`select app.manager_requests(${seeded.storeB}::uuid, null, 50)`,
		),
	).toBe("42501");
});
