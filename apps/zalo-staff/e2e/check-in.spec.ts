import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";
import {
	expectFeedbackWithin,
	expectOnePrimaryAction,
	expectResultModalClosed,
	watchResultModal,
} from "./entry-checks";

const NOON = new Date("2026-11-19T12:00:00+07:00");
const MEMBER_PHONE = "0900001234";
const LIVE_CODE = "246810";
const EXPIRED_CODE = "135790";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openCheckIn(page: Page, query: string): Promise<void> {
	await page.goto(`./${query}`);
	const card = page.getByTestId("home-loyalty");
	await expect(card).toBeVisible();
	await checkScreen(page);
	await card.getByRole("button", { name: "Ghi nhận khách" }).click();
	await expect(page.getByTestId("checkin-entry")).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "Ghi nhận khách" }),
	).toBeVisible();
}

test("staff record a customer by phone from the home; the visit waits for the synced invoice", async ({
	page,
}) => {
	await openCheckIn(page, "?role=staff");
	await checkScreen(page);
	await page.getByTestId("checkin-entry").fill("0123456789");
	await page.getByRole("button", { name: "Ghi nhận" }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		/^Số điện thoại chưa đúng\. Số di động Việt Nam gồm 10 chữ số/,
	);
	await checkScreen(page);
	await page.getByTestId("checkin-entry").fill(MEMBER_PHONE);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Ghi nhận" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(
		/Đã ghi nhận khách/,
	);
	await expectResultModalClosed(page);
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	await expect(page.getByTestId("checkin-confirm-by")).toHaveText(
		"Dự kiến xác nhận trước 12:10",
	);
	await expect(page.getByTestId("checkin-member")).toHaveText(
		"Khách •••• ••• 234",
	);
	await expect(page.locator("body")).not.toContainText(MEMBER_PHONE);
	await checkScreen(page);
	await page
		.getByTestId("checkin-result")
		.getByRole("button", { name: "Tra cứu thành viên" })
		.click();
	await expect(page.getByTestId("member-phone")).toHaveText("•••• ••• 234");
	const latest = page.getByTestId("visit").first();
	await expect(latest).toHaveAttribute("data-state", "pending");
	await expect(latest).toContainText("12:00 · Số điện thoại trên hóa đơn");
	await checkScreen(page);
});

test("a scanned member code records the customer in one tap", async ({
	page,
}) => {
	await openCheckIn(page, "?role=staff");
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Quét mã thành viên" }).click(),
	);
	await expect(page.getByTestId("checkin-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	await expect(page.getByTestId("checkin-member")).toHaveText(
		"Khách •••• ••• 234",
	);
	await expect(page.getByTestId("result-modal")).toHaveCount(0, {
		timeout: 3000,
	});
	await checkScreen(page);
});

test("a refused scan permission falls back to typing the 6-digit code", async ({
	page,
}) => {
	await openCheckIn(page, "?role=staff&scan=refused");
	await page.getByRole("button", { name: "Quét mã thành viên" }).click();
	await expect(page.getByTestId("scan-refused")).toContainText(
		"Bạn chưa cho phép quét mã. Hãy nhập mã 6 số",
	);
	await expect(page.getByTestId("checkin-entry")).toBeFocused();
	await checkScreen(page);
	await page.getByTestId("checkin-entry").fill(LIVE_CODE);
	await page.getByRole("button", { name: "Ghi nhận" }).click();
	await expect(page.getByTestId("checkin-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	await expect(page.getByTestId("result-modal")).toHaveCount(0, {
		timeout: 3000,
	});
	await page.getByRole("button", { name: "Ghi nhận khách khác" }).click();
	await page.getByTestId("checkin-entry").fill(LIVE_CODE);
	await page.getByRole("button", { name: "Ghi nhận" }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		"Mã này đã được ghi nhận rồi. Không cần ghi nhận lại.",
	);
	await checkScreen(page);
});

test("an expired member code is refused at the till", async ({ page }) => {
	await openCheckIn(page, "?role=staff");
	await page.getByTestId("checkin-entry").fill(EXPIRED_CODE);
	await page.getByRole("button", { name: "Ghi nhận" }).click();
	await expect(page.getByTestId("checkin-problem")).toHaveText(
		/^Mã đã hết hạn\. Mã chỉ dùng được trong 2 phút/,
	);
	await expect(page.getByTestId("checkin-result")).toHaveCount(0);
	await checkScreen(page);
});

test("English follows Zalo's language on Record a customer", async ({
	page,
}) => {
	await page.goto("./?lang=en&role=staff");
	await page
		.getByTestId("home-loyalty")
		.getByRole("button", { name: "Record a customer" })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Record a customer" }),
	).toBeVisible();
	await expect(page.getByLabel("Phone or 6-digit code")).toBeVisible();
	await checkScreen(page);
});
