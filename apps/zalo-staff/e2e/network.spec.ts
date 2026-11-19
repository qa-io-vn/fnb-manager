// Test design: error guessing and state transition testing of the staff app's till screens under network failures
// (offline at load, offline mid-action, a lost answer, slow and failing calls). test-gaps G-12, risk PR-09.
// In browser mode the app talks to an in-page stand-in, so there is no request to intercept; `?net=` turns the stand-in
// into a connection that fails like a real one (loyalty/demo-network.ts): `strict` fails any call made or answered while the
// browser is offline, `lost-once` commits the first change and loses its answer, `error-once` refuses it with a server error.
import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import { expectOnePrimaryAction } from "./entry-checks";

const NOON = new Date("2026-11-19T12:00:00+07:00");
const MEMBER_PHONE = "0900001234";
const POS_REWARD = "UD2468";

const NOT_SENT_VI =
	"Chưa gửi được vì mạng chập chờn. Kiểm tra kết nối rồi thử lại.";
const NOT_SENT_EN =
	"Not sent: the connection dropped. Check the network and try again.";
const OFFLINE_VI =
	"Mất kết nối mạng. Những gì bạn nhập vẫn còn; khi có mạng hãy thử lại.";
const OFFLINE_EN =
	"No network connection. What you entered is kept; try again once you are online.";
const SERVER_VI = "Có lỗi xảy ra. Hãy thử lại sau ít phút.";
const RECORDED_AGAIN_VI =
	"Khách này vừa được ghi nhận ở cửa hàng này. Lượt trước đang chờ hóa đơn, không cần ghi nhận lại.";
const RECORDED_AGAIN_EN =
	"This customer was just recorded at this store. That visit is waiting for its receipt; no need to record it again.";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openTool(
	page: Page,
	query: string,
	name: { vi: string; en: string },
	lang: "vi" | "en" = "vi",
): Promise<void> {
	await page.goto(`./?role=staff${lang === "en" ? "&lang=en" : ""}&${query}`);
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: name[lang] })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: name[lang] }),
	).toBeVisible();
}

const CHECK_IN = { vi: "Ghi nhận khách", en: "Record a customer" } as const;
const REDEEM = { vi: "Kiểm tra ưu đãi", en: "Check a reward" } as const;

async function record(page: Page, lang: "vi" | "en" = "vi"): Promise<void> {
	await page.getByTestId("checkin-entry").fill(MEMBER_PHONE);
	await page
		.getByRole("button", { name: lang === "vi" ? "Ghi nhận" : "Record" })
		.click();
}

async function pendingVisitsOfMember(page: Page): Promise<number> {
	await page.getByRole("button", { name: "Quay lại" }).click();
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Tra cứu thành viên" })
		.click();
	await page.getByTestId("lookup-phone").fill(MEMBER_PHONE);
	await page.getByRole("button", { name: "Tra cứu" }).click();
	await expect(page.getByTestId("member-phone")).toHaveText("•••• ••• 234");
	return page
		.getByTestId("visit")
		.evaluateAll(
			(items) =>
				items.filter((item) => item.getAttribute("data-state") === "pending")
					.length,
		);
}

// a connection the test controls: the browser reports offline from the first script on
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

test("offline at load: the banner shows on the screen, nothing is sent, the entry is kept and recording works once online", async ({
	page,
}) => {
	await offlineAtLoad(page);
	await openTool(page, "net=strict", CHECK_IN);
	const banner = page.getByTestId("offline");
	await expect(banner).toHaveText(OFFLINE_VI);
	await checkScreen(page);
	await record(page);
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await expect(page.getByTestId("checkin-entry")).toHaveValue(MEMBER_PHONE);
	await expect(
		page.getByRole("button", { name: "Ghi nhận", exact: true }),
	).toBeEnabled();
	await checkScreen(page);
	await reconnect(page);
	await expect(banner).toHaveCount(0);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("offline at load in English: the banner and the unsent notice speak English", async ({
	page,
}) => {
	await offlineAtLoad(page);
	await openTool(page, "net=strict", CHECK_IN, "en");
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_EN);
	await record(page, "en");
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_EN);
	await checkScreen(page);
});

test("offline at load on the reward check: the banner shows and the code is not checked", async ({
	page,
}) => {
	await offlineAtLoad(page);
	await openTool(page, "net=strict", REDEEM);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_VI);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await expect(page.getByTestId("redeem-result")).toHaveCount(0);
	await expect(page.getByTestId("redeem-code")).toHaveValue(POS_REWARD);
	await checkScreen(page);
});

test("going offline while Ghi nhận khách is being sent: nothing is recorded, the retry records once", async ({
	page,
	context,
}) => {
	await openTool(page, "net=strict&dataDelay=1500", CHECK_IN);
	await record(page);
	await expect(
		page.locator("button[type=submit][aria-busy=true]"),
	).toBeDisabled();
	await context.setOffline(true);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_VI);
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await checkScreen(page);
	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("a lost answer on Ghi nhận khách: the send was committed; the retry says the customer was just recorded, and there is one visit", async ({
	page,
}) => {
	await openTool(page, "net=lost-once", CHECK_IN);
	await record(page);
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Ghi nhận", exact: true }),
	).toBeEnabled();
	await checkScreen(page);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		RECORDED_AGAIN_VI,
	);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	await checkScreen(page);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("a lost answer on Ghi nhận khách in English", async ({ page }) => {
	await openTool(page, "net=lost-once", CHECK_IN, "en");
	await record(page, "en");
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_EN);
	await page.getByRole("button", { name: "Record", exact: true }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		RECORDED_AGAIN_EN,
	);
	await checkScreen(page);
});

test("the connection drops after the server committed: the answer is lost, the screen recovers on reconnect with one visit", async ({
	page,
	context,
}) => {
	await openTool(page, "net=strict&answerDelay=1500", CHECK_IN);
	await record(page);
	await expect(
		page.locator("button[type=submit][aria-busy=true]"),
	).toBeDisabled();
	await context.setOffline(true);
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		RECORDED_AGAIN_VI,
	);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("a slow endpoint: the button is busy and a second tap sends nothing more", async ({
	page,
}) => {
	await openTool(page, "net=strict&dataDelay=2500", CHECK_IN);
	await record(page);
	const send = page.locator("button[type=submit][aria-busy=true]");
	await expect(send).toBeDisabled();
	await expect(send).toHaveAttribute("aria-busy", "true");
	await page.locator("form").dispatchEvent("submit");
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("a failing endpoint: a server error is told in plain words and the retry records once", async ({
	page,
}) => {
	await openTool(page, "net=error-once", CHECK_IN);
	await record(page);
	await expect(page.getByTestId("loyalty-error")).toHaveText(SERVER_VI);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await checkScreen(page);
	await page.getByRole("button", { name: "Ghi nhận", exact: true }).click();
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	expect(await pendingVisitsOfMember(page)).toBe(1);
});

test("a lost answer on the reward check: the retry shows the first answer, checked before, to apply once", async ({
	page,
}) => {
	await openTool(page, "net=lost-once", REDEEM);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await expect(page.getByTestId("redeem-result")).toHaveCount(0);
	await expect(page.getByTestId("redeem-code")).toHaveValue(POS_REWARD);
	await checkScreen(page);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await expect(page.getByTestId("redeem-checked-before")).toHaveText(
		"Bạn đã kiểm tra mã này lúc 12:00. Chỉ áp dụng ưu đãi một lần.",
	);
	await expect(page.getByTestId("redeem-apply")).toHaveText(
		"Thành viên - Tặng 1 ly",
	);
	await expect(page.getByTestId("redeem-refused")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-error")).toHaveCount(0);
	await checkScreen(page);
});

test("a lost answer on the reward check in English", async ({ page }) => {
	await openTool(page, "net=lost-once", REDEEM, "en");
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Check", exact: true }).click();
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_EN);
	await page.getByRole("button", { name: "Check", exact: true }).click();
	await expect(page.getByTestId("redeem-checked-before")).toHaveText(
		/^You already checked this code at 12:00\. Apply the reward only once\.$/,
	);
	await checkScreen(page);
});

test("going offline while a reward is being checked: nothing is marked checked, the retry is the first check", async ({
	page,
	context,
}) => {
	await openTool(page, "net=strict&dataDelay=1500", REDEEM);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await context.setOffline(true);
	await expect(page.getByTestId("offline")).toHaveText(OFFLINE_VI);
	await expect(page.getByTestId("loyalty-error")).toHaveText(NOT_SENT_VI);
	await context.setOffline(false);
	await expect(page.getByTestId("offline")).toHaveCount(0);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
	await expect(page.getByTestId("redeem-accepted")).toBeVisible();
	await expect(page.getByTestId("redeem-checked-before")).toHaveCount(0);
	await checkScreen(page);
});
