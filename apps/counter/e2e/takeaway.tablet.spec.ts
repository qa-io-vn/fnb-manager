import type { Page } from "@playwright/test";
import {
	allowTakeawayBooking,
	bookTakeaway,
	nextSlot,
	restoreTakeawayBooking,
	seedCustomer,
} from "../test/support/seed";
import {
	asMember,
	clearQueue,
	contrastOf,
	expect,
	expectNoHorizontalScroll,
	nav,
	signIn,
	test,
} from "./support/fixtures";

// counter:e2e/takeaway (C17 "Chọn giờ lấy món" at the counter, ADR-072), on the tablets at 1280 and 1024 in Chromium
// and 1280 in WebKit; the booking made the server's way (the customer's placement with a pick-up time, then the
// payment's confirmation).
// - use case: a paid takeaway booked for later waits in "Hẹn giờ" as "hẹn HH:MM" with "bắt đầu pha HH:MM", out of
//   Mới and without the chime; its order and its ticket say "Hẹn HH:MM · bắt đầu pha HH:MM";
// - state transition on the counter's clock (Playwright's clock moved past start_at, the server unchanged): at its
//   start the order joins Mới as "lấy HH:MM" and the chime rings;
// - boundary values of the manager's form: 121 minutes and 101 orders refused in words under their fields (aria-invalid,
//   the focus on the first), 120, 30-minute slots and 100 orders saved; every field found by its label (the screen
//   reader's name) and reached with the keyboard;
// - light and dark: the card's words keep a contrast of 4.5:1 or more;
// - authorisation: RLS writes no row for staff (the manager pages' guard is counter:e2e/manager, "security: staff reach no manager page").

test.beforeEach(async ({ db, seeded }) => {
	await clearQueue(db, seeded);
	await allowTakeawayBooking(db, seeded);
});

test.afterEach(async ({ db, seeded }) => {
	await db`delete from public.orders where tenant_id = ${seeded.tenantId}`;
	await restoreTakeawayBooking(db, seeded);
});

/** "15:30" in Vietnam, as the counter writes a time. */
function clock(at: string | number): string {
	const local = new Date(new Date(at).getTime() + 7 * 3_600_000);
	return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function card(page: Page, id: string) {
	return page.locator(`[data-testid="order-card"][data-order-id="${id}"]`);
}

async function chimes(page: Page): Promise<number> {
	return Number(
		(await page.evaluate(() => document.documentElement.dataset.chimes)) ?? "0",
	);
}

test("a paid takeaway booked for later waits as 'hẹn' out of Mới, its order and ticket say when, and it joins Mới with the chime at its start", async ({
	page,
	seeded,
	db,
}) => {
	await page.addInitScript(() => {
		window.print = () => {
			const scope = window as unknown as { printed?: number };
			scope.printed = (scope.printed ?? 0) + 1;
		};
	});
	await signIn(page, seeded.people.staff);
	await page.getByTestId("sound-chip").click();
	const pickup = await nextSlot(db, 20);
	const start = new Date(pickup).getTime() - 15 * 60_000;
	const customer = await seedCustomer(db, seeded);
	const before = await chimes(page);
	const booked = await bookTakeaway(db, seeded, customer, pickup);

	const scheduled = page.getByTestId("lane-scheduled");
	await expect(scheduled).toBeVisible({ timeout: 10_000 });
	await expect(
		scheduled.getByRole("heading", { name: "Hẹn giờ · 1" }),
	).toBeVisible();
	const booking = card(page, booked.id);
	await expect(booking).toHaveAttribute("data-scheduled", "true");
	await expect(scheduled.locator(`[data-order-id="${booked.id}"]`)).toHaveCount(
		1,
	);
	await expect(booking.getByTestId("pickup-time")).toHaveText(
		`hẹn ${clock(pickup)}`,
	);
	await expect(booking.getByTestId("start-time")).toContainText(
		`bắt đầu pha ${clock(start)}`,
	);
	await expect(booking).toContainText("Mang đi");
	// prepaid: no "Chưa thu tiền" on it
	await expect(booking).not.toContainText("Chưa thu tiền");
	await expect(
		page.getByTestId("lane-new").locator(`[data-order-id="${booked.id}"]`),
	).toHaveCount(0);
	// a couple of polls later it still has not rung
	await page.waitForTimeout(4_500);
	expect(await chimes(page)).toBe(before);
	await expectNoHorizontalScroll(page);

	await booking.getByTestId("open-order").click();
	await expect(page.getByTestId("order-pickup")).toHaveText(
		`Hẹn ${clock(pickup)} · bắt đầu pha ${clock(start)}`,
	);
	await page.getByTestId("print-ticket").click();
	await expect
		.poll(() =>
			page.evaluate(
				() => (window as unknown as { printed?: number }).printed ?? 0,
			),
		)
		.toBe(1);
	await expect(page.getByTestId("print-ticket-view")).toContainText(
		`Hẹn ${clock(pickup)} · bắt đầu pha ${clock(start)}`,
	);
	await page.getByTestId("back-to-queue").click();

	// the counter's clock reaches the start: the server did not change the order, the queue lets it in by itself
	await page.clock.setFixedTime(new Date(start + 2_000));
	await expect(
		page.getByTestId("lane-new").locator(`[data-order-id="${booked.id}"]`),
	).toHaveCount(1, { timeout: 10_000 });
	await expect(booking).toHaveAttribute("data-scheduled", "false");
	await expect(booking.getByTestId("pickup-time")).toHaveText(
		`lấy ${clock(pickup)}`,
	);
	await expect(page.getByTestId("lane-scheduled")).toHaveCount(0);
	await expect.poll(() => chimes(page)).toBeGreaterThan(before);
	await expect(booking.getByTestId("card-start")).toBeVisible();
});

test("a manager sets the takeaway booking: refusals in words under their fields, the bounds saved, readable in light and dark; staff write nothing", async ({
	page,
	seeded,
	db,
}) => {
	await signIn(page, seeded.people.manager);
	await nav(page, "manager").click();
	await page.getByTestId("manager-menu").click();
	const settings = page.getByTestId("takeaway-settings");
	await expect(
		settings.getByRole("heading", { name: "Mang đi hẹn giờ" }),
	).toBeVisible();
	const prep = settings.getByLabel("Thời gian pha (phút)");
	const slot = settings.getByLabel("Độ dài khung giờ");
	const limit = settings.getByLabel("Số đơn mỗi khung");
	await expect(prep).toHaveValue("15");
	await expect(slot).toHaveValue("15");
	await expect(limit).toHaveValue("6");

	// boundary values one past the table's bounds, refused before any call
	await prep.fill("121");
	await limit.fill("101");
	await settings.getByRole("button", { name: "Lưu cài đặt mang đi" }).click();
	await expect(settings.getByTestId("takeaway-prep-error")).toHaveText(
		"Thời gian pha là số phút từ 0 đến 120.",
	);
	await expect(settings.getByTestId("takeaway-limit-error")).toHaveText(
		"Số đơn mỗi khung là số từ 1 đến 100.",
	);
	await expect(prep).toHaveAttribute("aria-invalid", "true");
	await expect(prep).toBeFocused();
	const [unchanged] = await db<{ p: number }[]>`
		select prep_minutes as p from public.store_ordering_settings where store_id = ${seeded.storeA}`;
	expect(unchanged?.p).toBe(15);

	// the bounds themselves, with the keyboard
	await prep.fill("120");
	await prep.press("Tab");
	await expect(slot).toBeFocused();
	await slot.selectOption("30");
	await limit.fill("100");
	await limit.press("Enter");
	await expect(page.getByText("Đã lưu cài đặt mang đi.")).toBeVisible();
	await expect(settings.getByTestId("takeaway-prep-error")).toHaveCount(0);
	const [row] = await db<{ p: number; s: number; l: number }[]>`
		select prep_minutes as p, takeaway_slot_minutes as s, takeaway_slot_limit as l
		from public.store_ordering_settings where store_id = ${seeded.storeA}`;
	expect(row).toEqual({ p: 120, s: 30, l: 100 });
	await expectNoHorizontalScroll(page);

	// light, then dark: the card's words stay readable
	for (const testId of ["takeaway-prep", "takeaway-slot", "takeaway-limit"]) {
		expect(
			await contrastOf(settings.getByTestId(testId)),
			testId,
		).toBeGreaterThanOrEqual(4.5);
	}
	expect(
		await contrastOf(settings.getByText("Từ 0 đến 120 phút", { exact: false })),
	).toBeGreaterThanOrEqual(4.5);
	const light = await settings.evaluate(
		(element) => getComputedStyle(element).backgroundColor,
	);
	await page.emulateMedia({ colorScheme: "dark" });
	await expect
		.poll(() =>
			settings.evaluate((element) => getComputedStyle(element).backgroundColor),
		)
		.not.toBe(light);
	for (const testId of ["takeaway-prep", "takeaway-slot", "takeaway-limit"]) {
		expect(
			await contrastOf(settings.getByTestId(testId)),
			testId,
		).toBeGreaterThanOrEqual(4.5);
	}
	expect(
		await contrastOf(
			settings.getByRole("heading", { name: "Mang đi hẹn giờ" }),
		),
	).toBeGreaterThanOrEqual(4.5);

	// staff: RLS writes no row for them
	const written = await asMember(db, seeded.people.staff.id, async (tx) => {
		await tx`set local role authenticated`;
		return await tx`update public.store_ordering_settings set takeaway_slot_limit = 9 where store_id = ${seeded.storeA} returning 1`;
	});
	expect(written).toHaveLength(0);
});
