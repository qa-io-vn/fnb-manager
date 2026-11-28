// C12 Thông báo in the ordering build (VITE_ORDERING=on) on the ordering projects: a 360 px phone in light and dark,
// and an iPhone in WebKit (design spec C12, GA-063 to GA-066; ADR-073). The data is the demo world; the test stands in
// for the counter through the demo till (DEMO_TILL_GLOBAL). ISTQB: use case end to end by keyboard with the names a
// screen reader reads (C01's bell with its count → C12 → a filter → a row → C06, and the row read on return); a
// decision table of what the shop's actions put in the inbox (paid, brought to the table, cancelled with the refund
// due, refunded in cash that day: criterion 4's message); state transitions of the marketing switch (off → the
// opt-in sheet → on → the follow offer; on → the stop sheet → off) with its role and state word; equivalence
// partitions of the empty states and of a visitor (joining instead of a switch). Every frame goes through the shared
// screen checks (contrast with axe in light and dark, 44-pixel targets, no text below 12 px, prices only as PriceText).
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const LOTUS_TEA = "eeeeeeee-0000-4000-8000-000000000007";

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

/** The customer's open order at the counter (placed earlier in the app), as the till sees it. */
async function openOrder(page: Page): Promise<string> {
	return String(
		await till(page, "pastOrder", {
			status: "accepted",
			daysAgo: 0,
			lines: [{ size: LOTUS_TEA, qty: 2 }],
		}),
	);
}

/** C01, opened at the app's start (the till's orders are the customer's, at Bàn 12, whatever the address). */
async function openHome(page: Page, search = ""): Promise<void> {
	await page.goto(`./${search}`);
	await expect(page.getByTestId("home")).toBeVisible();
	// the till is on the page once the session asked the ordering world for its first answer
	await page.waitForFunction((name) => name in window, TILL);
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page, null);
});

test("C12: the bell names the unread count, the list by keyboard, a filter, and a row opens its order (GA-063)", async ({
	page,
}) => {
	await openHome(page);
	const order = await openOrder(page);
	await till(page, "act", "pay", order);
	await till(page, "act", "start", order);
	await till(page, "act", "done", order);
	// the bell is read when the home shows: come back to it
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page
		.getByRole("navigation")
		.getByText("Trang chủ", { exact: true })
		.click();
	const bell = page.getByRole("button", { name: "Thông báo, 2 chưa đọc" });
	await expect(bell).toBeVisible();
	await expect(page.getByTestId("inbox-bell-badge")).toHaveText("2");
	await checkOrderingScreen(page);
	await bell.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("inbox")).toBeVisible();
	await expect(page.getByRole("heading", { name: "Thông báo" })).toBeVisible();
	const rows = page.getByTestId("inbox-row");
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0)).toHaveAttribute("data-kind", "order_ready");
	await expect(rows.nth(0)).toHaveAttribute("data-unread", "true");
	// the screen reader reads the row whole: what, the line, when, and "chưa đọc"
	await expect(
		page.getByRole("button", {
			name: /Món của bạn đã xong.*Trà sen và 1 món khác đang trên đường ra Bàn 12.*vừa xong.*chưa đọc/,
		}),
	).toBeVisible();
	await expect(rows.nth(1).locator("[data-price]")).toHaveAttribute(
		"data-price",
		"98000",
	);
	await checkOrderingScreen(page);
	// the filters are pressed buttons in a named group
	const offers = page
		.getByRole("group", { name: "Lọc thông báo" })
		.getByRole("button", { name: "Ưu đãi" });
	await offers.focus();
	await page.keyboard.press("Enter");
	await expect(offers).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByTestId("inbox-empty")).toHaveText(
		"Chưa có thông báo nào.",
	);
	await checkOrderingScreen(page);
	const all = page
		.getByRole("group", { name: "Lọc thông báo" })
		.getByRole("button", { name: "Tất cả" });
	await all.focus();
	await page.keyboard.press("Enter");
	await expect(rows).toHaveCount(2);
	await rows.nth(0).focus();
	await page.keyboard.press("Enter");
	await expect(page.getByTestId("order")).toBeVisible();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"serving",
	);
	await page
		.getByRole("navigation")
		.getByText("Trang chủ", { exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Thông báo, 1 chưa đọc" }),
	).toBeVisible();
});

test("C12: a paid order the shop cancels and refunds says how much comes back, how and when (criterion 4's message)", {
	tag: ["@criterion-4"],
}, async ({ page }) => {
	await openHome(page);
	const order = await openOrder(page);
	await till(page, "act", "pay", order);
	await till(page, "act", "refund", order);
	await page.getByTestId("inbox-bell").click();
	const rows = page.getByTestId("inbox-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.nth(0)).toHaveAttribute("data-kind", "order_refunded");
	await expect(rows.nth(0)).toContainText(/Đã hoàn tiền đơn #\d{3}/);
	await expect(rows.nth(0)).toContainText(
		/Quán đã trả lại .* tiền mặt ngày \d\d\/\d\d\/\d{4}\./,
	);
	await expect(rows.nth(0).locator("[data-price]")).toHaveAttribute(
		"data-price",
		"98000",
	);
	await expect(rows.nth(1)).toHaveAttribute("data-kind", "order_cancelled");
	await expect(rows.nth(1)).toContainText("Quán đang quá đông.");
	await expect(rows.nth(1)).toContainText("cho bạn theo cách bạn đã trả.");
	await expect(rows.nth(1).locator("[data-price]")).toHaveAttribute(
		"data-price",
		"98000",
	);
	await checkOrderingScreen(page);
	const orders = page
		.getByRole("group", { name: "Lọc thông báo" })
		.getByRole("button", { name: "Đơn hàng" });
	await orders.click();
	await expect(orders).toHaveAttribute("aria-pressed", "true");
	await expect(rows).toHaveCount(3);
	await expect(page.getByTestId("inbox-list")).toHaveAttribute(
		"data-filter",
		"orders",
	);
	await rows.nth(1).click();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"cancelled",
	);
});

test("C12: a member turns offers on Zalo on behind the opt-in sheet and off with the stop sheet, by keyboard (GA-064)", async ({
	page,
}) => {
	await page.goto("./?member=1&route=/thong-bao");
	const toggle = page.getByRole("switch", {
		name: "Nhận tin ưu đãi qua Zalo. Tối đa 2 tin mỗi tuần",
	});
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await expect(page.getByTestId("inbox-marketing-card")).toContainText(
		"Đang tắt",
	);
	await checkOrderingScreen(page);
	await toggle.focus();
	await page.keyboard.press("Space");
	const sheet = page.getByRole("dialog", { name: "Nhận tin ưu đãi qua Zalo?" });
	await expect(sheet).toBeVisible();
	await expect(sheet).toContainText(
		"Quán gửi tối đa 2 tin mỗi tuần, tắt lúc nào cũng được.",
	);
	await checkOrderingScreen(page);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
	await toggle.click();
	await page.getByRole("button", { name: "Đồng ý" }).click();
	await expect(page.getByTestId("inbox-opt-in-done")).toHaveText(
		"Đã bật nhận tin ưu đãi qua Zalo.",
	);
	await expect(toggle).toHaveAttribute("aria-checked", "true");
	await page.getByRole("button", { name: "Theo dõi Zalo của quán" }).click();
	await expect(page.getByText("Bạn đã theo dõi Zalo của quán.")).toBeVisible();
	await page.getByTestId("inbox-opt-in-close").click();
	await expect(page.getByTestId("inbox-marketing-card")).toContainText(
		"Đang bật",
	);
	await toggle.focus();
	await page.keyboard.press("Enter");
	const stop = page.getByRole("dialog", { name: "Dừng nhận tin khuyến mãi?" });
	await expect(stop).toBeVisible();
	await checkOrderingScreen(page);
	await stop.getByRole("button", { name: "Dừng nhận tin" }).click();
	await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("C12: a visitor is offered joining instead of the switch, and an empty inbox says so", async ({
	page,
}) => {
	await page.goto("./?route=/thong-bao");
	await expect(page.getByTestId("inbox-empty")).toHaveText(
		"Chưa có thông báo nào.",
	);
	await expect(page.getByTestId("inbox-marketing-join")).toContainText(
		"Tham gia thành viên để nhận tin ưu đãi qua Zalo.",
	);
	await expect(page.getByRole("switch")).toHaveCount(0);
	await checkOrderingScreen(page);
});

test("C12 regression: Tôi keeps its settings and names the inbox; C06 still tracks the order", async ({
	page,
}) => {
	await openHome(page, "?member=1&marketing=1");
	const order = await openOrder(page);
	await till(page, "act", "pay", order);
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	const row = page.locator("[data-testid=account-row][data-row=inbox]");
	await expect(row).toContainText("Thông báo và tin ưu đãi");
	await expect(row).toContainText("1 chưa đọc");
	await expect(page.getByTestId("settings-marketing")).toBeVisible();
	await expect(
		page
			.getByTestId("settings-marketing")
			.getByRole("button", { name: "Dừng nhận tin" }),
	).toBeVisible();
	await checkOrderingScreen(page);
	await row.click();
	await page.getByTestId("inbox-row").first().click();
	const tracked = page.getByTestId("order");
	await expect(tracked).toHaveAttribute("data-status", "accepted");
	await expect(tracked).toHaveAttribute("data-payment", "paid");
});
