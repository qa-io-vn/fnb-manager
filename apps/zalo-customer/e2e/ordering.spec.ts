// The ordering build (VITE_ORDERING=on) on the phone projects, light, dark and WebKit (design spec C01 to C20, the
// owner's acceptance criteria 1 to 3 where the customer app has a part). The data is the demo world; the test acts as
// the counter through the demo till the page exposes (DEMO_TILL_GLOBAL), the way the counter web app moves an order
// on the real stack. ISTQB: use cases end to end (scan → menu → item → basket → confirmation → tracking through every
// state), state transitions of the order, criterion 2 (sold out while in the basket, within 5 seconds), criterion 3
// (a double tap and a lost answer give one order), and error guessing for the security cases a browser can reach (a
// forged table token, another customer's order id, markup in a note).
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const BLACK_COFFEE = "dddddddd-0000-4000-8000-000000000002";
const MILK_COFFEE = "dddddddd-0000-4000-8000-000000000001";
const FOREIGN_ORDER = "ffffffff-0000-4000-8000-000000000001";

type TillMethod =
	| "act"
	| "soldOut"
	| "placements"
	| "openCalls"
	| "setOrdering"
	| "addRequest"
	| "proposeRequest"
	| "attachToCard"
	| "stampCodes";

async function till(
	page: Page,
	method: TillMethod,
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

async function openMenu(page: Page, search = TABLE): Promise<void> {
	await page.goto(`./${search}`);
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
}

async function addBlackCoffee(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
	await expect(page.getByTestId("cart-bar")).toBeVisible();
}

async function placeOrder(page: Page): Promise<void> {
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await submit.click();
	await expect(page.getByTestId("order")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page, null);
});

test("a table's QR opens its menu; the customer orders a coffee with options and follows it to the table", async ({
	page,
}) => {
	await openMenu(page);
	await expect(page.getByTestId("table-banner")).toHaveText(
		"Gọi món cho Bàn 12 · Tầng 1",
	);
	await expect(
		page
			.getByRole("navigation")
			.getByText(/^(Trang chủ|Thực đơn|Tích điểm|Tôi)$/),
	).toHaveCount(4);
	await checkOrderingScreen(page);

	await page
		.locator(`[data-testid=menu-item][data-item-id="${MILK_COFFEE}"]`)
		.getByRole("button")
		.first()
		.click();
	await expect(page.getByTestId("item-name")).toHaveText("Cà phê sữa");
	await expect(page.getByTestId("item-price")).toHaveAttribute(
		"data-price",
		"35000",
	);
	await page.getByRole("radio", { name: /^Lớn/ }).click();
	await page.getByRole("radio", { name: "Ít đá" }).click();
	await page.getByTestId("item-note").fill("ít ngọt, nhiều đá");
	await page.getByTestId("item-qty-plus").click();
	await expect(page.getByTestId("item-add")).toContainText("90.000đ");
	await checkOrderingScreen(page);
	await page.getByTestId("item-add").click();

	await expect(page.getByTestId("cart-bar-count")).toHaveText("2 món");
	await expect(page.getByTestId("cart-bar-total")).toHaveAttribute(
		"data-price",
		"90000",
	);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await expect(page.getByTestId("cart-table")).toHaveText("Gọi tại bàn Bàn 12");
	await expect(page.getByTestId("cart-line-options")).toHaveText(
		"Lớn · Ít đá · Bình thường",
	);
	await expect(page.getByTestId("cart-line-note")).toHaveText(
		"ít ngọt, nhiều đá",
	);
	await expect(page.getByTestId("cart-total")).toHaveAttribute(
		"data-price",
		"90000",
	);
	await checkOrderingScreen(page);

	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await expect(page.getByTestId("checkout-total")).toHaveAttribute(
		"data-price",
		"90000",
	);
	await expect(
		page.locator("[data-testid=payment-method][data-ready=false]"),
	).toHaveCount(2);
	await expect(page.getByTestId("payment-not-ready")).toHaveCount(2);
	await checkOrderingScreen(page);
	await submit.click();

	const order = page.getByTestId("order");
	await expect(order).toHaveAttribute("data-status", "accepted");
	await expect(page.getByTestId("order-headline")).toHaveText(
		"Mời bạn ra quầy thanh toán",
	);
	await expect(page.getByTestId("order-number")).toHaveText(
		/ĐƠN #\d{3}|Đơn #\d{3}/i,
	);
	await checkOrderingScreen(page);

	await till(page, "act", "pay");
	await till(page, "act", "start");
	await expect(order).toHaveAttribute("data-status", "preparing", {
		timeout: 5000,
	});
	await expect(page.getByTestId("order-headline")).toHaveText(
		"Đang pha cho bạn",
	);
	await till(page, "act", "done");
	await expect(order).toHaveAttribute("data-status", "serving", {
		timeout: 5000,
	});
	await expect(page.getByTestId("order-headline")).toHaveText(
		"Quán đang mang ra Bàn 12",
	);
	await till(page, "act", "complete");
	await expect(order).toHaveAttribute("data-status", "completed", {
		timeout: 5000,
	});
	await expect(
		page.locator("[data-testid=order-step][data-state=done]"),
	).toHaveCount(5);
	await checkOrderingScreen(page);

	await page
		.getByRole("navigation")
		.getByText("Tích điểm", { exact: true })
		.click();
	await expect(page.getByTestId("stamp-count")).toHaveText("2/9 dấu");
	await checkOrderingScreen(page);
});

test("an item sold out at the counter while it is in the basket is flagged within 5 seconds and blocks the order (criterion 2)", async ({
	page,
}) => {
	await openMenu(page);
	await addBlackCoffee(page);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await expect(page.getByTestId("cart-continue")).toBeEnabled();
	await till(page, "soldOut", BLACK_COFFEE, true);
	await expect(page.getByTestId("cart-line")).toHaveAttribute(
		"data-sold-out",
		"true",
		{ timeout: 5000 },
	);
	await expect(page.getByTestId("cart-continue")).toBeDisabled();
	await expect(page.getByTestId("cart-blocked")).toHaveText(
		"Bỏ món đã hết trước khi đặt.",
	);
	await checkOrderingScreen(page);
	await page.getByTestId("cart-line-remove").click();
	await expect(page.getByTestId("cart-empty")).toBeVisible();
	await page.getByTestId("cart-empty-menu").click();
	await expect(page.locator(`[data-item-id="${BLACK_COFFEE}"]`)).toHaveCount(0);
});

test("without VITE_ONLINE_PAYMENT the online ways to pay stay disabled even where the store offers them", async ({
	page,
}) => {
	await openMenu(page, `${TABLE}&payments=online`);
	await addBlackCoffee(page);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	await expect(page.getByTestId("checkout-submit")).toBeEnabled();
	await expect(
		page.locator("[data-testid=payment-method][data-ready=false]"),
	).toHaveCount(2);
	await expect(page.getByTestId("payment-not-ready")).toHaveCount(2);
	await expect(
		page.locator(
			"[data-testid=payment-method][data-method=counter][data-selected=true]",
		),
	).toHaveCount(1);
	await page.getByTestId("checkout-submit").click();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"accepted",
	);
	expect(await till(page, "placements")).toBe(1);
});

test("a double tap on Đặt món makes one order (criterion 3)", async ({
	page,
}) => {
	await openMenu(page, `${TABLE}&answerDelay=800`);
	await addBlackCoffee(page);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await submit.dblclick();
	await expect(page.getByTestId("order")).toBeVisible();
	expect(await till(page, "placements")).toBe(1);
});

test("a lost answer and a second tap give one order with the same request (criterion 3)", async ({
	page,
}) => {
	await openMenu(page, `${TABLE}&net=lost-once`);
	await addBlackCoffee(page);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	const submit = page.getByTestId("checkout-submit");
	await expect(submit).toBeEnabled();
	await submit.click();
	await expect(page.getByTestId("checkout-problem")).toHaveAttribute(
		"data-problem",
		"network",
	);
	await expect(page.getByTestId("checkout-problem")).toContainText(
		"đơn không bị đặt hai lần",
	);
	expect(await till(page, "placements")).toBe(1);
	await submit.click();
	await expect(page.getByTestId("order")).toBeVisible();
	expect(await till(page, "placements")).toBe(1);
});

test("Gọi nhân viên calls the staff once and says so; the call waits two minutes before it can be made again", async ({
	page,
}) => {
	await openMenu(page);
	await addBlackCoffee(page);
	await placeOrder(page);
	const call = page.getByTestId("order-call");
	await call.click();
	await expect(page.getByTestId("order-call-sent")).toHaveText(
		"Đã báo nhân viên, nhân viên tới ngay.",
	);
	await expect(call).toHaveAttribute("data-state", "wait");
	await expect(call).toBeDisabled();
	await expect(call).toContainText("Đã gọi lúc");
	expect(await till(page, "openCalls")).toBe(1);
	await checkOrderingScreen(page);
	await page.getByTestId("order-again").click();
	await expect(page.getByTestId("table-banner")).toHaveText(
		"Gọi món cho Bàn 12 · Tầng 1",
	);
});

test("the closed shop shows when it opens again and lets the customer read the menu without ordering (C15)", async ({
	page,
}) => {
	await openMenu(page, `${TABLE}&ordering=closed_now`);
	await expect(page.getByTestId("ordering-closed")).toHaveAttribute(
		"data-reason",
		"closed_now",
	);
	await expect(page.getByTestId("closed-reopen")).toContainText(
		"Mở lại lúc 07:00",
	);
	await expect(page.getByTestId("menu-item").first()).toBeVisible();
	await expect(page.getByTestId("menu-item-add")).toHaveCount(0);
	await checkOrderingScreen(page);
});

test("a pause holds the add buttons back and says why", async ({ page }) => {
	await openMenu(page, `${TABLE}&ordering=paused`);
	await expect(page.getByTestId("ordering-paused")).toHaveAttribute(
		"data-reason",
		"paused",
	);
	await expect(page.getByTestId("menu-item-add")).toHaveCount(0);
	await checkOrderingScreen(page);
});

test("offline with nothing to show, the menu is the offline state with a retry (C16)", async ({
	page,
}) => {
	await page.addInitScript(() => {
		Object.defineProperty(Navigator.prototype, "onLine", {
			configurable: true,
			get: () => false,
		});
	});
	await page.goto("./?net=strict");
	await page
		.getByRole("navigation")
		.getByText("Thực đơn", { exact: true })
		.click();
	await expect(page.getByTestId("offline-screen")).toBeVisible();
	await expect(page.getByTestId("offline-screen")).toHaveAttribute(
		"data-has-cart",
		"false",
	);
	await expect(page.getByTestId("offline-retry")).toBeVisible();
});

test("a forged table token shows no table, and no label comes from the address", async ({
	page,
}) => {
	await openMenu(page, "?store=mau-1&src=table&t=Ban-99-forged");
	await expect(page.getByTestId("table-refused")).toHaveAttribute(
		"data-refusal",
		"table_unknown",
	);
	await expect(page.getByTestId("table-banner")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText("Ban-99");
	await checkOrderingScreen(page);
});

test("the old card of a rotated table is refused", async ({ page }) => {
	await openMenu(page, "?store=mau-1&src=table&t=demo-table-12-old");
	await expect(page.getByTestId("table-refused")).toBeVisible();
	await addBlackCoffee(page);
	await page.getByTestId("cart-bar").getByRole("button").click();
	await expect(page.getByTestId("cart-continue")).toBeDisabled();
	await expect(page.getByTestId("cart-blocked")).toHaveText(
		"Quét mã trên bàn để đặt món tại bàn.",
	);
});

test("another customer's order id answers as an unknown order (IDOR)", async ({
	page,
}) => {
	await page.goto(`./?route=/don/${FOREIGN_ORDER}`);
	await expect(page.getByTestId("order-missing")).toBeVisible();
	await expect(page.getByTestId("order")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText("Bàn 3");
});

test("markup in a note is shown as text, never as markup", async ({ page }) => {
	const dialogs: string[] = [];
	page.on("dialog", (dialog) => {
		dialogs.push(dialog.message());
		void dialog.dismiss();
	});
	await openMenu(page);
	await page
		.locator(`[data-testid=menu-item][data-item-id="${BLACK_COFFEE}"]`)
		.getByRole("button")
		.first()
		.click();
	const hostile = '<img src=x onerror="alert(1)">';
	await page.getByTestId("item-note").fill(hostile);
	await page.getByTestId("item-add").click();
	await placeOrder(page);
	await expect(page.getByTestId("order-line-note")).toHaveText(hostile);
	await expect(page.locator('img[src="x"]')).toHaveCount(0);
	expect(dialogs).toEqual([]);
});

test("Tôi leads to the order history, the member code and the data screen, and deleting asks twice (C08, C14, C19)", async ({
	page,
}) => {
	await openMenu(page, `${TABLE}&member=1`);
	await addBlackCoffee(page);
	await placeOrder(page);
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	// orders, member code, company invoices (C18), requests, data
	await expect(page.getByTestId("account-row")).toHaveCount(5);
	await checkOrderingScreen(page);
	await page.locator("[data-testid=account-row][data-row=orders]").click();
	await expect(page.getByTestId("order-row")).toHaveCount(1);
	await expect(page.getByTestId("order-row")).toHaveAttribute(
		"data-status",
		"accepted",
	);
	await checkOrderingScreen(page);
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page.locator("[data-testid=account-row][data-row=data]").click();
	await expect(page.getByTestId("data-summary")).toBeVisible();
	await checkOrderingScreen(page);
	await page.getByTestId("data-delete").click();
	await expect(page.getByTestId("data-blocked")).toContainText(
		"Bạn còn 1 đơn chưa xong",
	);
	await checkOrderingScreen(page);
});

test("the member code can be enlarged on a white screen and shows the stamp card (C20)", async ({
	page,
}) => {
	await page.goto("./?member=1&store=mau-1&src=qr");
	await page
		.getByRole("navigation")
		.getByText("Tích điểm", { exact: true })
		.click();
	await page.getByTestId("wallet-code").click();
	await expect(page.getByTestId("stamp-number")).toHaveText(/^\d{4} \d{4}$/);
	await expect(page.getByTestId("code-brightness")).toBeVisible();
	await expect(page.getByTestId("code-stamps")).toContainText("0/9 dấu");
	await checkOrderingScreen(page);
	await page.getByTestId("code-enlarge").click();
	await expect(
		page.getByRole("dialog", { name: "Đưa mã cho thu ngân" }),
	).toBeVisible();
	await page.getByTestId("code-shrink").click();
	await expect(page.getByTestId("code-enlarged")).toHaveCount(0);
});

async function openMe(page: Page, row: string): Promise<void> {
	await page.getByRole("navigation").getByText("Tôi", { exact: true }).click();
	await page.locator(`[data-testid=account-row][data-row=${row}]`).click();
}

test("C20: a visitor's member code refreshes at 09:00, stays offline until it expires at 10:00, then a new one comes back online", async ({
	page,
	context,
}) => {
	await page.clock.install();
	await page.goto("./?store=mau-1&src=qr");
	await page
		.getByRole("navigation")
		.getByText("Tích điểm", { exact: true })
		.click();
	await page.getByTestId("wallet-code").click();
	const number = page.getByTestId("stamp-number");
	await expect(number).toHaveText(/^\d{4} \d{4}$/);
	const first = (await number.textContent()) ?? "";
	await expect(page.getByTestId("code-countdown")).toHaveText(
		/Mã làm mới sau 0[89]:\d\d/,
	);
	await checkOrderingScreen(page);
	expect(page.url()).not.toContain(first.replace(" ", ""));
	expect(await page.content()).not.toContain("fnb-stamp:");
	// BVA: at the refresh time the app asks for a new code by itself
	await page.clock.fastForward("09:01");
	await expect(number).not.toHaveText(first);
	expect(await till(page, "stampCodes")).toBe(2);
	// offline: the code shown keeps working until its expiry, and says until when
	await context.setOffline(true);
	await expect(page.getByTestId("code-offline")).toContainText(
		"Mã đã lưu vẫn dùng được đến",
	);
	await expect(page.getByTestId("code-refresh")).toBeDisabled();
	await page.clock.fastForward("10:01");
	await expect(page.getByTestId("code-expired")).toHaveText(
		"Mã đã hết hạn. Lấy mã mới để quầy quét.",
	);
	await expect(page.getByTestId("stamp-qr")).toHaveCount(0);
	await context.setOffline(false);
	await page.evaluate(() => window.dispatchEvent(new Event("online")));
	await expect(number).toHaveText(/^\d{4} \d{4}$/);
	expect(await till(page, "stampCodes")).toBe(3);
});

test("C20: the counter's attach shows on the code screen at once, with the stamps it will earn", async ({
	page,
}) => {
	await page.goto("./?route=/ma-thanh-vien");
	await expect(page.getByTestId("stamp-number")).toBeVisible();
	await till(page, "attachToCard", 3);
	await expect(page.getByTestId("code-attached")).toContainText(
		"Đơn xong thì 3 dấu vào thẻ.",
		{ timeout: 15_000 },
	);
	await checkOrderingScreen(page);
});

test("C19: a visitor reads the copy of their data and deletes the login at once; markup in the data stays text", async ({
	page,
}) => {
	await openMenu(page);
	await page
		.getByRole("button", { name: /^Cà phê đen/ })
		.first()
		.click();
	await page.getByTestId("item-note").fill('<img src=x onerror="alert(1)">');
	await page.getByTestId("item-add").click();
	await placeOrder(page);
	await till(page, "act", "pay");
	await till(page, "act", "start");
	await till(page, "act", "done");
	await till(page, "act", "complete");
	await openMe(page, "data");
	await page.getByTestId("data-export").click();
	await expect(page.getByTestId("data-export-how")).toBeVisible();
	await page.getByTestId("data-export-load").click();
	const view = page.getByTestId("data-export-view");
	await expect(view).toContainText("Tài khoản Zalo");
	await expect(view).toContainText('<img src=x onerror="alert(1)">');
	await expect(view.locator("img")).toHaveCount(0);
	await checkOrderingScreen(page);
	await page.getByTestId("data-export-copy").click();
	await expect(page.getByTestId("data-export-copied")).toBeVisible();
	await page.getByRole("button", { name: "Về Dữ liệu của bạn" }).click();
	await page.getByTestId("data-delete").click();
	await page.getByTestId("data-continue").click();
	await expect(page.getByTestId("data-confirm-delete")).toBeDisabled();
	await page.getByTestId("data-confirm-check").click();
	await page.getByTestId("data-confirm-delete").click();
	await expect(page.getByTestId("data-deleted")).toContainText(
		"Đã xóa tài khoản",
	);
	await checkOrderingScreen(page);
	await page.getByTestId("data-deleted-menu").click();
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
});

test("C06 and C14: the order says when it should be ready once accepted and paid, and so does the history", async ({
	page,
}) => {
	await openMenu(page);
	await addBlackCoffee(page);
	await placeOrder(page);
	await expect(page.getByTestId("order-eta")).toHaveCount(0);
	await till(page, "act", "pay");
	await expect(page.getByTestId("order-eta")).toHaveText(
		/Dự kiến xong lúc \d\d:\d\d, khoảng 10 phút nữa/,
		{ timeout: 10_000 },
	);
	await checkOrderingScreen(page);
	await openMe(page, "orders");
	await expect(page.getByTestId("order-row-ready")).toHaveText(
		/Dự kiến xong lúc \d\d:\d\d/,
	);
});

test("the customer's request with another time proposed by the store, cancelled (new → proposed → cancelled)", async ({
	page,
}) => {
	await openMenu(page);
	await till(page, "addRequest");
	await till(page, "proposeRequest");
	await openMe(page, "requests");
	const card = page.getByTestId("my-request");
	await expect(card.getByTestId("my-request-status")).toHaveText(
		"Quán đề xuất giờ khác",
	);
	await expect(card.getByTestId("my-request-proposed")).toContainText(
		"Quán đề xuất: 19:30",
	);
	await checkOrderingScreen(page);
	await card.getByTestId("my-request-cancel").click();
	await page.getByTestId("my-request-confirm-cancel").click();
	await expect(card.getByTestId("my-request-status")).toHaveText("Đã hủy");
	await expect(card.getByTestId("my-request-cancel")).toHaveCount(0);
	await checkOrderingScreen(page);
});
