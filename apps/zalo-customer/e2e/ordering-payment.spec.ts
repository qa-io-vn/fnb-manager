// Paying online in the ordering build with VITE_ONLINE_PAYMENT=on (the payment projects: light, dark and WebKit), on
// the demo world with `?payments=online`: the world stands in for checkout-order, the gateway and the bank, and the
// test acts as them through the demo till (DEMO_TILL_GLOBAL), as the real gateway's callback and the bank's
// notification do on the server. The owner's acceptance criteria: (1) order and pay by each way, the order reaches the
// counter (the till's accepted order with a number stands in for the counter's board); (3) a failed payment or a
// customer leaving midway leaves no duplicate order and no order shown paid that the server did not accept. ISTQB: use
// cases end to end per way to pay, state transitions of the order (awaiting_payment → accepted, → failed attempt → a
// new one → accepted, → expired → a new counter order), error guessing (a client claiming success, a double tap, a
// transfer of another amount), and the regression of a store that offers only the counter.
import {
	checkMiniAppScreen,
	expectPricesOnlyWhereAllowed,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { watchCustomerPage } from "./customer-checks";

const TILL = "__FNB_DEMO_TILL__";
const TABLE = "?store=mau-1&src=table&t=demo-table-12";
const ONLINE = `${TABLE}&payments=online`;
/** a poll of the order is every 3 seconds: a change is seen within two */
const POLLED = { timeout: 8000 };

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

async function toCheckout(page: Page, search = ONLINE): Promise<void> {
	await page.goto(`./${search}`);
	await expect(page.getByTestId("ordering-menu")).toBeVisible();
	await page.getByRole("button", { name: "Thêm Cà phê đen vào giỏ" }).click();
	await page.getByTestId("cart-bar").getByRole("button").click();
	await page.getByTestId("cart-continue").click();
	await expect(page.getByTestId("checkout-submit")).toBeEnabled();
}

function method(page: Page, name: string) {
	return page.locator(`[data-testid=payment-method][data-method=${name}]`);
}

async function placeWith(page: Page, name: string): Promise<void> {
	await method(page, name).click();
	await expect(method(page, name)).toHaveAttribute("data-selected", "true");
	await page.getByTestId("checkout-submit").click();
	await expect(page.getByTestId("pay-step")).toBeVisible();
}

async function expectAccepted(page: Page): Promise<void> {
	const order = page.getByTestId("order");
	await expect(order).toHaveAttribute("data-status", "accepted", POLLED);
	await expect(order).toHaveAttribute("data-payment", "paid");
	await expect(page.getByTestId("order-number")).toHaveText(
		/ĐƠN #\d{3}|Đơn #\d{3}/i,
	);
}

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page, null);
});

test("pays with the wallet: the server accepts the order with a number once the gateway reports the money", async ({
	page,
}) => {
	await toCheckout(page);
	await expect(
		page.locator("[data-testid=payment-method][data-ready=true]"),
	).toHaveCount(3);
	await expect(page.getByTestId("payment-not-ready")).toHaveCount(0);
	await checkOrderingScreen(page);
	await placeWith(page, "zalo_checkout");
	const sheet = page.getByTestId("stand-in-sheet");
	await expect(sheet).toBeVisible();
	await expect(page.getByTestId("stand-in-amount")).toHaveAttribute(
		"data-price",
		"29000",
	);
	await expect(page.getByTestId("pay-step")).toHaveAttribute(
		"data-view",
		"waiting",
	);
	await checkOrderingScreen(page);
	expect(await till(page, "status")).toBe("awaiting_payment");
	await page.getByTestId("stand-in-pay").click();
	await expectAccepted(page);
	expect(await till(page, "placements")).toBe(1);
	expect(await till(page, "attempts")).toBe(1);
	await checkOrderingScreen(page);
});

test("a failed wallet payment shows C11; Thử lại opens a new attempt that pays", async ({
	page,
}) => {
	await toCheckout(page);
	await placeWith(page, "zalo_checkout");
	await expect(page.getByTestId("stand-in-sheet")).toBeVisible();
	await till(page, "walletResult", undefined, "failed");
	const result = page.getByTestId("payment-result");
	await expect(result).toHaveAttribute("data-state", "failed", POLLED);
	await expect(page.getByTestId("payment-body")).toContainText(
		"Thanh toán chưa hoàn tất.",
	);
	await expect(page.getByTestId("pay-counter")).toBeEnabled();
	await checkOrderingScreen(page);
	await page.getByTestId("payment-retry").click();
	await page.getByTestId("stand-in-pay").click();
	await expectAccepted(page);
	expect(await till(page, "attempts")).toBe(2);
	expect(await till(page, "placements")).toBe(1);
});

test("pays by QR transfer: the in-app VietQR, and the exact transfer pays the order", async ({
	page,
}) => {
	await toCheckout(page);
	await placeWith(page, "vietqr");
	const transfer = page.getByTestId("transfer");
	await expect(transfer).toBeVisible();
	await expect(page.getByTestId("transfer-qr")).toHaveAttribute(
		"data-payload",
		/^000201/,
	);
	await expect(page.getByTestId("transfer-amount")).toHaveAttribute(
		"data-price",
		"29000",
	);
	await expect(page.getByTestId("transfer-bank")).toContainText(
		"Ngân hàng Mẫu",
	);
	await expect(page.getByTestId("transfer-account-value")).toHaveText(
		"0123456789",
	);
	await expect(page.getByTestId("transfer-name")).toContainText("CUA HANG MAU");
	const reference = String(await till(page, "reference"));
	await expect(page.getByTestId("transfer-reference-value")).toHaveText(
		reference,
	);
	await expect(page.getByTestId("transfer-countdown")).toContainText(
		"Mã còn hiệu lực",
	);
	await checkOrderingScreen(page);
	expect(await till(page, "bankTransfer", reference, 29000)).toBe("paid");
	await expectAccepted(page);
});

test("a transfer of another amount leaves the order waiting; when the time runs out C11 says expired and Trả tại quầy places a counter order", async ({
	page,
}) => {
	await toCheckout(page);
	await placeWith(page, "vietqr");
	await expect(page.getByTestId("transfer")).toBeVisible();
	const first = await till(page, "latestOrder");
	const reference = String(await till(page, "reference"));
	expect(await till(page, "bankTransfer", reference, 20000)).toBe("held");
	await page.waitForTimeout(3500);
	await expect(page.getByTestId("pay-step")).toHaveAttribute(
		"data-view",
		"transfer",
	);
	expect(await till(page, "status")).toBe("awaiting_payment");
	await till(page, "expirePayment");
	const result = page.getByTestId("payment-result");
	await expect(result).toHaveAttribute("data-state", "expired", POLLED);
	await expect(page.getByTestId("payment-body")).toHaveText(
		"Hết thời gian thanh toán nên đơn đã được hủy. Bạn chưa bị trừ tiền.",
	);
	await expect(page.getByTestId("payment-retry")).toHaveCount(0);
	await checkOrderingScreen(page);
	await page.getByTestId("pay-counter").click();
	const order = page.getByTestId("order");
	await expect(order).toHaveAttribute("data-status", "accepted");
	await expect(order).toHaveAttribute("data-payment", "unpaid");
	await expect(page.getByTestId("order-headline")).toHaveText(
		"Mời bạn ra quầy thanh toán",
	);
	expect(await till(page, "placements")).toBe(2);
	expect(await till(page, "status", first)).toBe("cancelled");
	expect(await till(page, "latestOrder")).not.toBe(first);
});

test("a client that claims success while the gateway heard nothing never shows the order paid", async ({
	page,
}) => {
	await toCheckout(page, `${ONLINE}&wallet=claim`);
	await placeWith(page, "zalo_checkout");
	await page.getByTestId("stand-in-pay").click();
	await expect(page.getByTestId("pay-waiting")).toHaveAttribute(
		"data-note",
		"claimed",
	);
	await page.waitForTimeout(7000);
	await expect(page.getByTestId("pay-step")).toHaveAttribute(
		"data-view",
		"waiting",
	);
	await expect(page.getByTestId("order")).toHaveCount(0);
	expect(await till(page, "status")).toBe("awaiting_payment");
	await page.getByTestId("pay-to-order").click();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"awaiting_payment",
	);
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-payment",
		"unpaid",
	);
	await expect(page.getByTestId("order-number")).toHaveCount(0);
});

test("a double tap on Đặt món makes one order and one payment attempt", async ({
	page,
}) => {
	await toCheckout(page, `${ONLINE}&answerDelay=800`);
	await method(page, "zalo_checkout").click();
	await page.getByTestId("checkout-submit").dblclick();
	await expect(page.getByTestId("stand-in-sheet")).toBeVisible();
	expect(await till(page, "placements")).toBe(1);
	expect(await till(page, "attempts")).toBe(1);
});

test("a store that offers only the counter keeps the online ways to pay disabled", async ({
	page,
}) => {
	await toCheckout(page, TABLE);
	await expect(
		page.locator("[data-testid=payment-method][data-ready=false]"),
	).toHaveCount(2);
	await expect(page.getByTestId("payment-not-ready")).toHaveCount(2);
	await expect(method(page, "zalo_checkout").getByRole("radio")).toBeDisabled();
	await expect(method(page, "vietqr").getByRole("radio")).toBeDisabled();
	await page.getByTestId("checkout-submit").click();
	await expect(page.getByTestId("order")).toHaveAttribute(
		"data-status",
		"accepted",
	);
	expect(await till(page, "attempts")).toBe(0);
});
