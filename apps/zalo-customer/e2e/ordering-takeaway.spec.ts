// Takeaway with a chosen pick-up time (C17, missing-screens 5.6; ADR-072) in the ordering build with online payment
// (the takeaway projects: 360 px light, 390 px dark and WebKit as an iPhone), on the demo world with `?takeaway=on`
// (the store open 07:00-23:00, 15 minutes to prepare, 15-minute slots, two orders a slot) at a fixed clock: Friday
// 27/11/2026 14:05, or 23:30 for the closed shop. The demo world answers customer_takeaway_slots,
// customer_place_order and customer_change_pickup as pgTAP 304 and 305 prove the server does; the test acts as the
// gateway and as other customers through the demo till.
// ISTQB: use cases end to end (C17-E1 open, C17-E2 closed and booked for the morning, the time passing while paying);
// error guessing (C17-E3 the slot fills between viewing and paying); state transitions of the screens (C17-E4 back and
// forward keep the choice); each frame checked at 360 and 390 px, light and dark, on Chromium and WebKit (C17-E5: the
// shared screen checks: targets of 44 px, axe, no outbound link, no web storage, prices only in PriceText); keyboard
// only and the accessible names of the slots (a radio group "Giờ lấy", "Hết chỗ" in the name, aria-disabled, the
// alert); regression of table orders (C17-R1), of C15 where takeaway is not offered (C17-R2) and of criterion 3 (C17-R3:
// leaving mid-payment makes no second order and nothing shown paid that the server did not accept).
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const OPEN = "?payments=online&takeaway=on";
const CLOSED = "?payments=online&takeaway=on&ordering=closed_now";
const AFTERNOON = new Date("2026-11-27T14:05:00+07:00");
const NIGHT = new Date("2026-11-27T23:30:00+07:00");
/** a poll of the order is every 3 seconds: a change is seen within two */
const POLLED = { timeout: 8000 };

function at(local: string): string {
	return new Date(`${local}+07:00`).toISOString();
}

async function till(
	page: Page,
	method: string,
	...args: unknown[]
): Promise<unknown> {
	return page.evaluate(
		({ name, method, args }) => {
			const target = (
				window as unknown as Record<
					string,
					Record<string, (...a: unknown[]) => unknown>
				>
			)[name];
			if (target === undefined) throw new Error("no demo till on the page");
			return target[method]?.(...args);
		},
		{ name: TILL, method, args },
	);
}

async function checkOrderingScreen(page: Page): Promise<void> {
	await checkMiniAppScreen(page);
	await expectPricesOnlyWhereAllowed(page, { allowed: true });
}

async function addCoffee(page: Page): Promise<void> {
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
	await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
	await page.getByTestId("cart-bar").getByRole("button").click();
	await expect(page.getByTestId("cart-takeaway")).toHaveText(
		"Mang đi · Lấy tại quầy",
	);
	await page.getByTestId("cart-continue").click();
	await expect(page.getByTestId("checkout")).toBeVisible();
}

async function toCheckout(page: Page): Promise<void> {
	await page.goto(`./${OPEN}`);
	const tile = page.getByTestId("home-tile-takeaway");
	await expect(tile).toContainText("Mang đi");
	await expect(tile).toContainText("Hẹn giờ lấy");
	await tile.click();
	await addCoffee(page);
}

function slot(page: Page, local: string) {
	return page.locator(`[data-testid=pickup-slot][data-at="${at(local)}"]`);
}

async function choose(page: Page, local: string): Promise<void> {
	await slot(page, local).click();
	await expect(slot(page, local)).toHaveAttribute("data-selected", "true");
}

async function toPickup(page: Page): Promise<void> {
	await page.getByTestId("checkout-pickup-change").click();
	await expect(page.getByTestId("pickup-slots")).toBeVisible();
}

async function payInWallet(page: Page): Promise<void> {
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await expect(submit).toContainText("Thanh toán");
	await submit.click();
	await expect(page.getByTestId("pay-step")).toBeVisible();
	await page.getByTestId("stand-in-pay").click();
	const order = page.getByTestId("order");
	await expect(order).toHaveAttribute("data-status", "accepted", POLLED);
	await expect(order).toHaveAttribute("data-payment", "paid");
}

test.describe("takeaway open (14:05)", () => {
	test.beforeEach(async ({ page }) => {
		await watchCustomerPage(page, AFTERNOON);
	});

	test("C17-E1: C05 offers the online ways only, C17 books 15:00, paid, and the order shows its pick-up time", {
		tag: ["@criterion-1"],
	}, async ({ page }) => {
		await toCheckout(page);
		await expect(page.getByTestId("fulfilment")).toHaveAttribute(
			"data-mode",
			"takeaway",
		);
		await expect(page.locator("[data-testid=payment-method]")).toHaveCount(2);
		await expect(
			page.locator("[data-testid=payment-method][data-method=counter]"),
		).toHaveCount(0);
		await expect(page.getByTestId("checkout-takeaway-prepaid")).toHaveText(
			"Đơn mang đi không có “Trả tại quầy”. Tiền về thì quán mới bắt đầu pha.",
		);
		await expect(page.getByTestId("checkout-submit")).toBeDisabled();
		await checkOrderingScreen(page);

		await toPickup(page);
		const pickup = page.getByTestId("pickup");
		await expect(pickup).toHaveAttribute("data-state", "open");
		await expect(page.getByTestId("pickup-asap")).toContainText(
			"Dự kiến 14:20, khoảng 15 phút nữa",
		);
		await expect(page.getByTestId("pickup-kicker")).toHaveText(
			"Hoặc hẹn giờ lấy",
		);
		await expect(page.getByTestId("pickup-date")).toHaveText(
			"Hôm nay, 27/11/2026",
		);
		await expect(
			page.locator("[data-testid=pickup-slot]").first(),
		).toHaveAttribute("data-at", at("2026-11-27T14:30:00"));
		await expect(page.getByTestId("pickup-prepay")).toContainText(
			"Đơn mang đi cần thanh toán trước.",
		);
		await expect(page.getByTestId("pickup-continue")).toBeDisabled();
		await checkOrderingScreen(page);

		await choose(page, "2026-11-27T15:00:00");
		await expect(page.getByTestId("pickup-chosen")).toHaveText("15:00 hôm nay");
		await page.getByTestId("pickup-continue").click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 15:00",
		);
		await expect(
			page.locator("[data-testid=payment-method][data-method=zalo_checkout]"),
		).toHaveAttribute("data-selected", "true");
		await checkOrderingScreen(page);

		await payInWallet(page);
		await expect(page.getByTestId("order-number")).toHaveText(
			/ĐƠN #\d{3}|Đơn #\d{3}/i,
		);
		await expect(page.getByTestId("order-pickup")).toHaveText(
			"Mang đi · lấy lúc 15:00 hôm nay",
		);
		await expect(page.getByTestId("order-pickup-start")).toHaveText(
			"Quán bắt đầu pha lúc 14:45 để kịp giờ lấy.",
		);
		expect(await till(page, "placements")).toBe(1);
		expect(await till(page, "pickupOf")).toBe(at("2026-11-27T15:00:00"));
		await checkOrderingScreen(page);
	});

	test("C17-E3: the slot fills between viewing and paying: C17 says so in words with the nearest free times", async ({
		page,
	}) => {
		await toCheckout(page);
		await toPickup(page);
		await choose(page, "2026-11-27T15:00:00");
		await page.getByTestId("pickup-continue").click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 15:00",
		);
		// two other customers take both places of 15:00 meanwhile
		expect(await till(page, "fillSlot", at("2026-11-27T15:00:00"), 2)).toBe(2);
		await page.getByTestId("checkout-submit").click();
		const problem = page.getByTestId("pickup-problem");
		await expect(problem).toHaveText(
			"Giờ 15:00 vừa hết chỗ. Chọn giờ khác để tiếp tục. Giờ gần nhất còn chỗ là 15:15 và 15:30.",
		);
		await expect(problem).toHaveAttribute("role", "alert");
		await expect(slot(page, "2026-11-27T15:00:00")).toHaveAttribute(
			"data-full",
			"true",
		);
		await expect(slot(page, "2026-11-27T15:00:00")).toContainText("Hết chỗ");
		await expect(page.getByTestId("pickup-full-hint")).toBeVisible();
		await expect(page.getByTestId("pickup-chosen")).toHaveText("Chưa chọn");
		await expect(page.getByTestId("pickup-continue")).toHaveText(
			"Chọn giờ lấy",
		);
		await expect(page.getByTestId("pickup-continue")).toBeDisabled();
		await checkOrderingScreen(page);
		expect(await till(page, "placements")).toBe(0);

		await choose(page, "2026-11-27T15:15:00");
		await page.getByTestId("pickup-continue").click();
		await payInWallet(page);
		expect(await till(page, "placements")).toBe(1);
		expect(await till(page, "pickupOf")).toBe(at("2026-11-27T15:15:00"));
	});

	test("C17-E4: back and forward keep the choice", async ({ page }) => {
		await toCheckout(page);
		await toPickup(page);
		await choose(page, "2026-11-27T16:00:00");
		await page.getByTestId("pickup-continue").click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 16:00",
		);
		// back to the basket and forward again: the choice stays
		await page
			.getByTestId("checkout")
			.getByRole("button", { name: "Quay lại" })
			.click();
		await expect(page.getByTestId("cart-takeaway")).toBeVisible();
		await expect(page.getByTestId("cart")).toContainText(
			"Giờ lấy: 16:00 hôm nay",
		);
		await page.getByTestId("cart-continue").click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 16:00",
		);
		// forward to C17 and back: the slot is still the one chosen
		await toPickup(page);
		await expect(slot(page, "2026-11-27T16:00:00")).toHaveAttribute(
			"data-selected",
			"true",
		);
		await expect(page.getByTestId("pickup-chosen")).toHaveText("16:00 hôm nay");
		await page
			.getByTestId("pickup")
			.getByRole("button", { name: "Quay lại" })
			.click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 16:00",
		);
		await expect(page.getByTestId("checkout-submit")).toBeEnabled();
	});

	test("keyboard only and the screen reader's names: a radio group Giờ lấy, Hết chỗ in the name, the choice announced", async ({
		page,
	}) => {
		await toCheckout(page);
		await till(page, "fillSlot", at("2026-11-27T14:45:00"), 2);
		const change = page.getByTestId("checkout-pickup-change");
		await change.focus();
		await page.keyboard.press("Enter");
		const group = page.getByRole("radiogroup", { name: "Giờ lấy" });
		await expect(group).toBeVisible();
		await expect(
			group.getByRole("radio", { name: "14:45, hết chỗ" }),
		).toHaveAttribute("aria-disabled", "true");
		const first = group.getByRole("radio", { name: "14:30", exact: true });
		await first.focus();
		await page.keyboard.press("Space");
		await expect(first).toBeChecked();
		await expect(page.getByTestId("pickup-chosen")).toHaveText("14:30 hôm nay");
		// the arrow keys move the choice along the group; a full slot is never chosen
		await page.keyboard.press("ArrowRight");
		await page.keyboard.press("ArrowRight");
		await expect(
			group.getByRole("radio", { name: "15:00", exact: true }),
		).toBeChecked();
		await expect(page.getByTestId("pickup-chosen")).toHaveText("15:00 hôm nay");
		const go = page.getByRole("button", { name: "Tiếp tục thanh toán" });
		await go.focus();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Hôm nay · 15:00",
		);
		await expect(
			page.getByRole("button", { name: "Đổi giờ lấy" }),
		).toBeVisible();
	});

	test("the time passes while paying: Giờ lấy đã qua, and the booking moves to another slot", async ({
		page,
	}) => {
		await toCheckout(page);
		// a store that prepares in 5 minutes: a booking can pass its start while its 10-minute hold is open
		await till(page, "setPrepMinutes", 5);
		await toPickup(page);
		await choose(page, "2026-11-27T14:15:00");
		await page.getByTestId("pickup-continue").click();
		// by transfer, whose QR stays on the page (the wallet's sheet would cover it)
		await page
			.locator("[data-testid=payment-method][data-method=vietqr]")
			.click();
		await page.getByTestId("checkout-submit").click();
		await expect(page.getByTestId("transfer")).toBeVisible();
		await page.clock.setSystemTime(new Date("2026-11-27T14:11:00+07:00"));
		const passed = page.getByTestId("pay-pickup-passed");
		await expect(passed).toContainText(
			"Giờ lấy đã qua. Chọn giờ khác.",
			POLLED,
		);
		await checkOrderingScreen(page);
		await page.getByTestId("pay-pickup-choose").click();
		await choose(page, "2026-11-27T14:30:00");
		await expect(page.getByTestId("pickup-continue")).toHaveText("Đổi giờ lấy");
		await page.getByTestId("pickup-continue").click();
		await expect(page.getByTestId("pay-step")).toBeVisible();
		await expect(page.getByTestId("pay-pickup")).toHaveText(
			"Giờ lấy: 14:30 hôm nay",
		);
		await expect(page.getByTestId("pay-pickup-passed")).toHaveCount(0);
		expect(await till(page, "placements")).toBe(1);
		expect(await till(page, "pickupOf")).toBe(at("2026-11-27T14:30:00"));
	});

	test("C17-R1: a table order from its QR is unaffected: at the table, and still payable at the counter", async ({
		page,
	}) => {
		await page.goto(
			"./?store=mau-1&src=table&t=demo-table-12&payments=online&takeaway=on",
		);
		await expect(page.getByTestId("ordering-menu")).toBeVisible();
		await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
		await page.getByTestId("cart-bar").getByRole("button").click();
		await expect(page.getByTestId("cart-table")).toBeVisible();
		await page.getByTestId("cart-continue").click();
		await expect(page.getByTestId("fulfilment")).toHaveAttribute(
			"data-mode",
			"table",
		);
		await expect(page.getByTestId("checkout-pickup")).toHaveCount(0);
		await expect(page.locator("[data-testid=payment-method]")).toHaveCount(3);
		await page
			.locator("[data-testid=payment-method][data-method=counter]")
			.click();
		await page.getByTestId("checkout-submit").click();
		const order = page.getByTestId("order");
		await expect(order).toHaveAttribute("data-status", "accepted");
		await expect(order).toHaveAttribute("data-payment", "unpaid");
		await expect(page.getByTestId("order-pickup")).toHaveCount(0);
	});

	test("C17-R3: leaving the wallet midway makes no second order and shows nothing paid", {
		tag: ["@criterion-3"],
	}, async ({ page }) => {
		await toCheckout(page);
		await toPickup(page);
		await choose(page, "2026-11-27T15:30:00");
		await page.getByTestId("pickup-continue").click();
		await page.getByTestId("checkout-submit").click();
		await expect(page.getByTestId("stand-in-sheet")).toBeVisible();
		await page.getByTestId("stand-in-cancel").click();
		const result = page.getByTestId("payment-result");
		await expect(result).toHaveAttribute("data-state", "left", POLLED);
		expect(await till(page, "status")).toBe("awaiting_payment");
		// takeaway is prepaid: no "Trả tại quầy" to switch to
		await expect(page.getByTestId("pay-counter")).toHaveCount(0);
		await checkOrderingScreen(page);
		await page.getByTestId("payment-retry").click();
		await page.getByTestId("stand-in-pay").click();
		const order = page.getByTestId("order");
		await expect(order).toHaveAttribute("data-status", "accepted", POLLED);
		expect(await till(page, "placements")).toBe(1);
		expect(await till(page, "pickupOf")).toBe(at("2026-11-27T15:30:00"));
	});
});

test.describe("takeaway closed (23:30)", () => {
	test.beforeEach(async ({ page }) => {
		await watchCustomerPage(page, NIGHT);
	});

	test("C17-E2: C15 offers the morning; booked for 07:30, paid, and shown in the order status with its time", async ({
		page,
	}) => {
		await page.goto(`./${CLOSED}`);
		const closed = page.getByTestId("ordering-closed");
		await expect(closed).toHaveAttribute("data-preorder", "true");
		await expect(page.getByTestId("closed-body")).toContainText(
			"Bạn vẫn xem thực đơn và hẹn giờ lấy món cho sáng mai được.",
		);
		await checkOrderingScreen(page);
		await page.getByRole("button", { name: "Hẹn lấy món sáng mai" }).click();
		await addCoffee(page);
		await toPickup(page);
		await expect(page.getByTestId("pickup")).toHaveAttribute(
			"data-state",
			"closed",
		);
		await expect(page.getByTestId("pickup-closed")).toContainText(
			"Quán đang đóng cửa",
		);
		await expect(page.getByTestId("pickup-asap")).toHaveCount(0);
		await expect(page.getByTestId("pickup-kicker")).toHaveText(
			"Hẹn giờ lấy sáng mai",
		);
		await expect(page.getByTestId("pickup-date")).toHaveText(
			"Thứ Bảy, 28/11/2026 · mở cửa 07:00",
		);
		await expect(
			page.locator("[data-testid=pickup-slot]").first(),
		).toHaveAttribute("data-at", at("2026-11-28T07:00:00"));
		await checkOrderingScreen(page);
		await choose(page, "2026-11-28T07:30:00");
		await expect(page.getByTestId("pickup-chosen")).toHaveText(
			"07:30 sáng mai",
		);
		await page.getByTestId("pickup-continue").click();
		await expect(page.getByTestId("checkout-pickup-when")).toHaveText(
			"Ngày mai · 07:30",
		);
		await payInWallet(page);
		await expect(page.getByTestId("order-pickup")).toHaveText(
			"Mang đi · lấy lúc 07:30 sáng mai",
		);
		await checkOrderingScreen(page);
	});

	test("C17-R2: where takeaway is not offered, C15 is as it was", async ({
		page,
	}) => {
		await page.goto("./?payments=online&ordering=closed_now");
		const closed = page.getByTestId("ordering-closed");
		await expect(closed).toHaveAttribute("data-preorder", "false");
		await expect(page.getByTestId("closed-body")).toContainText(
			"Bạn vẫn xem thực đơn được.",
		);
		await expect(page.getByTestId("closed-preorder")).toHaveCount(0);
		await expect(page.getByTestId("home-tile-takeaway")).toHaveCount(0);
		await checkOrderingScreen(page);
	});
});
