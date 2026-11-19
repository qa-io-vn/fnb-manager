// Test design: error guessing and state transition testing of the customer app under network failures (offline at load,
// offline mid-action, a lost answer, slow and failing calls). test-gaps G-34, G-12, risk PR-09.
// In browser mode the app talks to an in-page stand-in, so there is no request to intercept; `?net=` turns the stand-in
// into a connection that fails like a real one (demo/world.ts): `strict` fails any call made or answered while the browser
// is offline, `lost-once` commits the first change and loses its answer, `error-once` refuses it with a server error;
// `answerDelay` is the time between the commit and the answer, the window in which the connection can drop.
import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	openHome,
	openTab,
	PROGRAMME,
	watchCustomerPage,
} from "./customer-checks";

const NETWORK_VI = "Mất kết nối mạng. Kiểm tra mạng rồi thử lại.";
const NETWORK_EN = "No connection. Check the network and try again.";
const UNKNOWN_VI = "Chưa tải được dữ liệu. Hãy thử lại sau ít phút.";
const OFFLINE_VI =
	"Bạn đang ngoại tuyến. Thông tin trên màn hình có thể chưa mới; ứng dụng tự tải lại khi có mạng.";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

async function offlineAtLoad(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const state = window as unknown as { __offline?: boolean };
		state.__offline = true;
		Object.defineProperty(Navigator.prototype, "onLine", {
			configurable: true,
			get: () => state.__offline !== true,
		});
	});
}

async function reconnect(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as unknown as { __offline?: boolean }).__offline = false;
		window.dispatchEvent(new Event("online"));
	});
}

async function openClaim(page: Page, search: string): Promise<void> {
	await openHome(page, `?member=1&${search}`);
	await page
		.getByRole("button", { name: /Nhận điểm từ hóa đơn|Claim/ })
		.click();
	await expect(page.getByTestId("claim-form")).toBeVisible();
}

async function fillClaim(page: Page): Promise<void> {
	await page.getByTestId("claim-store").selectOption("mau-1");
	await page.getByTestId("claim-receipt").fill("4321");
	await page.getByTestId("claim-amount").fill("52000");
}

const send = (page: Page) =>
	page.getByRole("button", { name: "Gửi hóa đơn", exact: true });
const busy = (page: Page) =>
	page.locator("button[type=submit][aria-busy=true]");

async function claimItems(page: Page): Promise<string[]> {
	await page.getByRole("button", { name: "Xem thẻ thành viên" }).click();
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(page.getByTestId("claim-item").first()).toBeVisible();
	return page
		.getByTestId("claim-item")
		.evaluateAll((items) =>
			items.map((item) => item.getAttribute("data-state") ?? ""),
		);
}

test("offline at load: the notice and a way to retry show, and the app loads by itself when the connection is back", async ({
	page,
}) => {
	await offlineAtLoad(page);
	await page.goto("./?member=1&net=strict");
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_VI);
	await expect(page.getByTestId("failed")).toContainText(NETWORK_VI);
	await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
	await checkCustomerScreen(page);
	await reconnect(page);
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await expect(page.getByTestId("failed")).toHaveCount(0);
	await checkCustomerScreen(page);
});

test("offline at load in English", async ({ page }) => {
	await offlineAtLoad(page);
	await page.goto("./?member=1&net=strict&lang=en");
	await expect(page.getByTestId("failed")).toContainText(NETWORK_EN);
	await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
	await checkCustomerScreen(page);
});

test("a lost answer on Gửi hóa đơn: the retry shows the first claim's state, not a refusal for a receipt sent before", async ({
	page,
}) => {
	await openClaim(page, "net=lost-once");
	await fillClaim(page);
	await send(page).click();
	await expect(page.getByTestId("claim-form").getByRole("alert")).toHaveText(
		NETWORK_VI,
	);
	await expect(page.getByTestId("claim-result")).toHaveCount(0);
	await expect(page.getByTestId("claim-receipt")).toHaveValue("4321");
	await expect(send(page)).toBeEnabled();
	await checkCustomerScreen(page);
	await send(page).click();
	const result = page.getByTestId("claim-result");
	await expect(result).toHaveAttribute("data-state", "pending");
	await expect(result).toContainText("Đã gửi hóa đơn");
	await expect(result).not.toContainText("đã được gửi trước đó");
	await checkCustomerScreen(page);
	expect(await claimItems(page)).toContain("pending");
});

test("a lost answer on Gửi hóa đơn in English", async ({ page }) => {
	await page.goto("./?member=1&net=lost-once&lang=en");
	await page.getByRole("button", { name: "Earn from a receipt" }).click();
	await page.getByTestId("claim-store").selectOption("mau-1");
	await page.getByTestId("claim-receipt").fill("4321");
	await page.getByTestId("claim-amount").fill("52000");
	await page.getByRole("button", { name: "Send the receipt" }).click();
	await expect(page.getByTestId("claim-form").getByRole("alert")).toHaveText(
		NETWORK_EN,
	);
	await page.getByRole("button", { name: "Send the receipt" }).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expect(page.getByTestId("claim-result")).toContainText("Receipt sent");
	await checkCustomerScreen(page);
});

test("going offline while a claim is being sent: nothing is claimed, and the retry sends it once", async ({
	page,
	context,
}) => {
	await openClaim(page, "net=strict&dataDelay=1500");
	await fillClaim(page);
	await send(page).click();
	await expect(busy(page)).toBeDisabled();
	await context.setOffline(true);
	await expect(page.getByTestId("claim-form").getByRole("alert")).toHaveText(
		NETWORK_VI,
	);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_VI);
	await checkCustomerScreen(page);
	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await send(page).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	expect(await claimItems(page)).toEqual(["pending"]);
});

test("the connection drops after the claim was committed: the answer is lost and the retry shows the first claim", async ({
	page,
	context,
}) => {
	await openClaim(page, "net=strict&answerDelay=1500");
	await fillClaim(page);
	await send(page).click();
	await expect(busy(page)).toBeDisabled();
	await context.setOffline(true);
	await expect(page.getByTestId("claim-form").getByRole("alert")).toHaveText(
		NETWORK_VI,
	);
	await context.setOffline(false);
	await send(page).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expect(page.getByTestId("claim-result")).not.toContainText(
		"đã được gửi trước đó",
	);
	await checkCustomerScreen(page);
});

test("a slow endpoint: the button is busy and a second submit sends nothing more", async ({
	page,
}) => {
	await openClaim(page, "net=strict&dataDelay=2500");
	await fillClaim(page);
	await send(page).click();
	await expect(busy(page)).toBeDisabled();
	await expect(busy(page)).toHaveText("Đang gửi…");
	await page.getByTestId("claim-form").dispatchEvent("submit");
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	expect(await claimItems(page)).toEqual(["pending"]);
});

test("a failing endpoint: a server error is told in plain words and the retry sends the claim once", async ({
	page,
}) => {
	await openClaim(page, "net=error-once");
	await fillClaim(page);
	await send(page).click();
	await expect(page.getByTestId("claim-form").getByRole("alert")).toHaveText(
		UNKNOWN_VI,
	);
	await expect(page.getByTestId("claim-result")).toHaveCount(0);
	await checkCustomerScreen(page);
	await send(page).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	expect(await claimItems(page)).toEqual(["pending"]);
});

test("a lost answer on Xác nhận đổi: the retry says the code is already held, in the voucher wallet", async ({
	page,
}) => {
	await page.goto("./?member=1&vouchers=1&store=mau-1&src=qr&net=lost-once");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await openTab(page, "Thẻ thành viên");
	await page.getByRole("button", { name: "Ví voucher" }).click();
	await page.getByRole("button", { name: "Đổi quà" }).click();
	const rewards = page.getByTestId("reward");
	await rewards.nth(0).getByRole("button", { name: "Đổi quà" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Đổi Tặng 1 ly cà phê sữa?",
	});
	await dialog.getByRole("button", { name: "Xác nhận đổi" }).click();
	// the notice is inside the dialog, not hidden behind it
	await expect(dialog.getByTestId("redeem-problem")).toHaveText(NETWORK_VI);
	await dialog.getByTestId("redeem-problem").click({ trial: true });
	await expect(
		dialog.getByRole("button", { name: "Xác nhận đổi" }),
	).toBeEnabled();
	await dialog.getByRole("button", { name: "Xác nhận đổi" }).click();
	await expect(page.getByTestId("redeem-problem")).toHaveText(
		"Bạn đang giữ mã của quà này. Xem trong Ví voucher.",
	);
	await checkCustomerScreen(page);
});
