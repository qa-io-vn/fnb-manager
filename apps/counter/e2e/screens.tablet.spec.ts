import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { readMemberCode } from "../src/orders/member";
import {
	issueStampCode,
	placeCustomerOrder,
	seedCustomer,
	seedJoinedCustomer,
	TEA,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	counterToken,
	expect,
	expectNoHorizontalScroll,
	nav,
	openShiftFor,
	refusalOf,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/screens (native-till.md section 16 wired into the counter, 2026-11-28):
// - Q02 (state transitions, use case): a short count → the reason step (the four reasons, a required note of one line,
//   BVA at 200/201 characters) → the reason sent and kept → the manager reads it beside the numbers, preselected, and
//   confirms on another device; the count stays blind until counted;
// - Q01 payment (decision table, error guessing): without a shift at this counter, cash and card say so and offer "Vào
//   ca"; a shift closed elsewhere is refused by the server (shift_required) and worded, nothing paid;
// - Q01 member code (EP/BVA of the 8 digits and the Luhn check, use case): a mistyped number is caught on the tablet
//   without asking the server; the right one shows only the short name and the stamps; the card follows the ticket
//   into the order; the camera reads a QR where the browser can (BarcodeDetector stubbed); security: no full name, no
//   phone, the code in no address and no console line; another store's staff cannot attach (IDOR).

type Db = Parameters<typeof seedCustomer>[0];

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
	await db`delete from public.staff_shifts where tenant_id = ${seeded.tenantId}`;
	await db`update public.menu_store_items set sold_out_until = null where tenant_id = ${seeded.tenantId}`;
});

async function countNotes(
	page: Page,
	prefix: string,
	notes: Record<number, number>,
) {
	for (const [denomination, count] of Object.entries(notes)) {
		await page.getByTestId(`${prefix}-${denomination}`).fill(String(count));
	}
}

async function counterOrderFor(
	db: Db,
	userId: string,
	store: string,
	size: string,
): Promise<string> {
	return await asMember(db, userId, async (tx) => {
		const [row] = await tx<{ r: { order: { id: string } } }[]>`
			select app.counter_create_order(${store}::uuid, ${tx.json({
				request_id: randomUUID(),
				type: "takeaway",
				lines: [{ size, qty: 2 }],
			} as never)}::jsonb) as r`;
		return row?.r.order.id ?? "";
	});
}

async function issuedNumber(
	db: Db,
	seeded: Parameters<typeof seedCustomer>[1],
	customer: string,
): Promise<{ number: string; qr: string }> {
	const answer = (await issueStampCode(db, seeded, customer)) as {
		state: string;
		code: { number: string; qr_payload: string };
	};
	expect(answer.state).toBe("issued");
	return { number: answer.code.number, qr: answer.code.qr_payload };
}

test("Q02: a short count asks the reason, the reason is sent with a note and the manager confirms with it", {
	tag: ["@criterion-6"],
}, async ({ page, browser, seeded, db }) => {
	const token = await counterToken(db, seeded);
	await signIn(page, seeded.people.staff2);
	await nav(page, "shift").click();
	await page.getByTestId("counter-code").fill(token);
	await countNotes(page, "opening", { 500000: 2 });
	await page.getByTestId("clock-in-submit").click();
	await expect(page.getByTestId("open-shift")).toBeVisible();
	// blind: nothing of the expected cash before the count
	await expect(page.getByTestId("open-shift")).not.toContainText("Dự kiến");
	await expect(page.getByTestId("reason-step")).toHaveCount(0);
	await page.getByTestId("clock-out").click();
	await countNotes(page, "closing", { 500000: 1, 200000: 2, 50000: 1 });
	await page.getByTestId("clock-out-submit").click();
	await expect(page.getByTestId("cash-difference")).toContainText("Thiếu tiền");
	const step = page.getByTestId("reason-step");
	await expect(step).toBeVisible();
	await expect(step).toContainText("Bắt buộc");
	for (const reason of [
		"Trả nhầm tiền thừa",
		"Quên ghi đơn",
		"Chi tiền lặt vặt",
		"Chưa rõ nguyên nhân",
	])
		await expect(
			page.getByTestId("cashier-reason").getByRole("button", { name: reason }),
		).toBeVisible();
	await expect(page.getByTestId("reason-submit")).toBeDisabled();
	await page
		.getByTestId("cashier-reason")
		.getByRole("button", { name: "Chi tiền lặt vặt" })
		.click();
	// a reason without a note is not sent; 201 characters are too many, 200 are fine
	await expect(page.getByTestId("reason-submit")).toBeDisabled();
	await page.getByTestId("reason-note").fill("a".repeat(201));
	await expect(page.getByTestId("reason-note-hint")).toContainText("dài quá");
	await expect(page.getByTestId("reason-submit")).toBeDisabled();
	await page.getByTestId("reason-note").fill("a".repeat(200));
	await expect(page.getByTestId("reason-submit")).toBeEnabled();
	await page.getByTestId("reason-note").fill("Mua đá cho quầy");
	await expectNoHorizontalScroll(page);
	await page.getByTestId("reason-submit").click();
	await expect(page.getByTestId("toast")).toContainText("Đã gửi lý do");
	await expect(page.getByTestId("reason-given")).toContainText(
		"Chi tiền lặt vặt · Mua đá cho quầy",
	);
	await expect(page.getByTestId("reason-step")).toHaveCount(0);
	await expect(page.getByTestId("manager-needed")).toBeVisible();
	const [kept] = await db<
		{ difference_reason: string; difference_note: string }[]
	>`
		select difference_reason, difference_note from public.staff_shifts where user_id = ${seeded.people.staff2.id}`;
	expect(kept).toEqual({
		difference_reason: "petty_cash",
		difference_note: "Mua đá cho quầy",
	});

	const managerContext = await browser.newContext({
		viewport: { width: 1280, height: 800 },
	});
	const manager = await managerContext.newPage();
	await signIn(manager, seeded.people.manager);
	await manager.goto("/#/quan-ly/ca-lam");
	const row = manager
		.getByTestId("shift-row")
		.filter({ hasText: seeded.people.staff2.name });
	await row.getByTestId("confirm-shift-open").click();
	await expect(manager.getByTestId("cashier-reason-shown")).toContainText(
		"Chi tiền lặt vặt · Mua đá cho quầy",
	);
	await expect(
		manager
			.getByTestId("difference-reason")
			.getByRole("button", { name: "Chi tiền lặt vặt" }),
	).toHaveAttribute("aria-pressed", "true");
	await manager.getByTestId("confirm-note").fill("Đã xem phiếu chi");
	await manager.getByTestId("confirm-shift-submit").click();
	await expect(row).toHaveAttribute("data-status", "closed");
	await managerContext.close();
	await expect(page.getByTestId("clock-in")).toBeVisible({ timeout: 20_000 });
});

test("Q01: without a shift at this counter cash and card say so and offer Vào ca; a shift closed elsewhere is refused by the server", {
	tag: ["@criterion-6"],
}, async ({ page, seeded, db }) => {
	const customer = await seedCustomer(db, seeded);
	const placed = await placeCustomerOrder(db, seeded, customer, {
		table: seeded.tables.t1,
		lines: [{ size: seeded.sizes.tea, qty: 1 }],
		expectedTotal: TEA,
	});
	const id = placed.order?.id ?? "";
	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${id}`);
	await page.getByTestId("open-pay").click();
	for (const method of ["cash", "card"]) {
		await page.getByTestId(`pay-${method}`).click();
		await expect(page.getByTestId("pay-need-shift")).toContainText(
			"Bạn chưa vào ca ở quầy này",
		);
		await expect(page.getByTestId("pay-submit")).toBeDisabled();
	}
	await page.getByTestId("pay-go-shift").click();
	await expect(page).toHaveURL(/#\/ca$/);
	await expect(page.getByTestId("clock-in")).toBeVisible();

	// the screen believes the person on shift, but the shift was closed meanwhile (another device)
	await openShiftFor(db, seeded, seeded.people.staff.id);
	await page.goto(`/#/don/${id}`);
	await page.reload();
	await page.getByTestId("open-pay").click();
	await page.getByTestId("pay-card").click();
	await expect(page.getByTestId("pay-need-shift")).toHaveCount(0);
	await db`delete from public.staff_shifts where user_id = ${seeded.people.staff.id}`;
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("pay-need-shift")).toContainText(
		"Bạn chưa vào ca ở quầy này. Vào ca rồi thu tiền.",
	);
	await expect(page.getByTestId("pay-submit")).toBeDisabled();
	const [order] = await db<{ payment_status: string }[]>`
		select payment_status::text from public.orders where id = ${id}`;
	expect(order?.payment_status).toBe("unpaid");
});

test("Q01: the member number is checked on the tablet, shows only the short name and stamps, and the card follows the ticket into the order", async ({
	page,
	seeded,
	db,
}) => {
	await openShiftFor(db, seeded, seeded.people.staff.id);
	// one phone per run: the projects share the seeded tenant, and a phone is unique in it
	const phone = `09${String(Date.now()).slice(-8)}`;
	const joined = await seedJoinedCustomer(db, seeded, "Trần Thị Mẫu", phone);
	const { number, qr } = await issuedNumber(db, seeded, joined);
	const slipped = `${number.slice(0, 7)}${(Number(number[7]) + 1) % 10}`;
	expect(readMemberCode(slipped).ok).toBe(false);
	const lookups: string[] = [];
	const logs: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("counter_member_lookup"))
			lookups.push(request.url());
	});
	page.on("console", (message) => logs.push(message.text()));

	await signIn(page, seeded.people.staff);
	await page.getByTestId("new-counter-order").click();
	await page.locator('[data-testid="menu-tile"][data-item="Trà đào"]').click();
	await page.getByTestId("type-takeaway").click();
	await page.getByTestId("ticket-member-scan").click();
	const dialog = page.getByTestId("member-dialog");
	await expect(
		dialog
			.getByTestId("member-scan")
			.or(dialog.getByTestId("member-no-camera")),
	).toBeVisible();
	await expect(dialog).toContainText("Quầy chỉ thấy tên rút gọn và số dấu");
	// a slip of one digit is caught here: the check digit is wrong, nothing is asked
	await dialog.getByTestId("member-number").fill(slipped);
	await expect(dialog.getByTestId("member-number")).toHaveValue(
		`${slipped.slice(0, 4)} ${slipped.slice(4)}`,
	);
	await expect(dialog.getByTestId("member-number-hint")).toContainText(
		"Số chưa đúng",
	);
	await expect(dialog.getByTestId("member-check")).toBeDisabled();
	await expect(dialog.getByTestId("member-number")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	// 7 digits: not yet a number to check
	await dialog.getByTestId("member-number").fill(number.slice(0, 7));
	await expect(dialog.getByTestId("member-check")).toBeDisabled();
	expect(lookups).toHaveLength(0);
	await dialog.getByTestId("member-number").fill(number);
	await dialog.getByTestId("member-check").click();
	await expect(dialog.getByTestId("member-name")).toHaveText(
		"Đọc được mã: Mẫu",
	);
	await expect(dialog.getByTestId("member-stamps")).toContainText(
		"Đang có 0/9 dấu.",
	);
	// security: the counter sees the short name only, never the full name or the phone
	await expect(dialog).not.toContainText("Trần Thị");
	await expect(dialog).not.toContainText(phone);
	await expectNoHorizontalScroll(page);
	await dialog.getByTestId("member-attach").click();
	await expect(page.getByTestId("ticket-member-name")).toContainText("Mẫu");
	await page.getByTestId("create-pay").click();
	await page.getByTestId("pay-quick-39000").click();
	await page.getByTestId("pay-submit").click();
	await expect(page.getByTestId("create-done")).toBeVisible();
	const [order] = await db<{ attached: boolean; payment_status: string }[]>`
		select member_login_id is not null as attached, payment_status::text
		from public.orders where tenant_id = ${seeded.tenantId} and source = 'counter'`;
	expect(order).toEqual({ attached: true, payment_status: "paid" });
	// the code is in no address and no console line
	expect(page.url()).not.toContain(number);
	expect(page.url()).not.toContain(qr.slice(12));
	expect(lookups.every((url) => !url.includes(number))).toBe(true);
	expect(logs.join("\n")).not.toContain(number);
	expect(logs.join("\n")).not.toContain(qr.slice(12));
});

test("Q01: on an order, the camera reads the member QR and the card is attached; an unknown code is worded; another store cannot attach", async ({
	page,
	seeded,
	db,
	browserName,
}) => {
	test.skip(
		browserName === "webkit",
		"the camera stub needs a canvas stream; the typed path runs on WebKit",
	);
	const visitor = await seedCustomer(db, seeded);
	const { number, qr } = await issuedNumber(db, seeded, visitor);
	const order = await counterOrderFor(
		db,
		seeded.people.staff.id,
		seeded.storeA,
		seeded.sizes.coffeeM,
	);
	await page.addInitScript((payload: string) => {
		const scope = window as unknown as {
			BarcodeDetector?: unknown;
			__scans?: number;
		};
		scope.BarcodeDetector = class {
			async detect() {
				scope.__scans = (scope.__scans ?? 0) + 1;
				return [{ rawValue: payload }];
			}
		};
		Object.defineProperty(navigator, "mediaDevices", {
			configurable: true,
			value: {
				getUserMedia: async () => {
					const canvas = document.createElement("canvas");
					canvas.width = 16;
					canvas.height = 16;
					canvas.getContext("2d")?.fillRect(0, 0, 16, 16);
					return canvas.captureStream(5);
				},
			},
		});
	}, qr);
	await signIn(page, seeded.people.staff);
	await page.goto(`/#/don/${order}`);
	await page.getByTestId("open-member").click();
	const dialog = page.getByTestId("member-dialog");
	// an unknown (well-formed) number is refused by the server and worded
	let unknown = "";
	for (let seed = 1; unknown === ""; seed += 1) {
		for (let check = 0; check <= 9; check += 1) {
			const candidate = `${String(seed).padStart(7, "0")}${check}`;
			if (readMemberCode(candidate).ok && candidate !== number) {
				unknown = candidate;
				break;
			}
		}
	}
	await dialog.getByTestId("member-number").fill(unknown);
	await dialog.getByTestId("member-check").click();
	await expect(dialog.getByTestId("member-message")).toContainText(
		"Mã không đúng hoặc đã hết hạn",
	);
	await dialog.getByTestId("member-scan").click();
	await expect(dialog.getByTestId("member-name")).toHaveText(
		"Đọc được mã: khách chưa ghi tên",
	);
	await expect(dialog.getByTestId("member-stamps")).toContainText(
		"cộng 2 dấu khi đơn hoàn thành",
	);
	await dialog.getByTestId("member-attach").click();
	await expect(page.getByTestId("toast")).toContainText("Đã gắn thẻ vào đơn");
	await expect(page.getByTestId("member-attached")).toBeVisible();
	await expect(page.getByTestId("open-member")).toHaveCount(0);
	await expect(page.getByTestId("order-log")).toBeVisible();

	// IDOR: store B's staff cannot attach to store A's order, nor look up at store A
	expect(
		await refusalOf(
			db,
			seeded.people.staffB.id,
			(tx) =>
				tx`select app.counter_attach_member(${order}::uuid, ${number}, 2)`,
		),
	).toBe("42501");
	expect(
		await refusalOf(
			db,
			seeded.people.staffB.id,
			(tx) =>
				tx`select app.counter_member_lookup(${seeded.storeA}::uuid, ${number})`,
		),
	).toBe("42501");
});
