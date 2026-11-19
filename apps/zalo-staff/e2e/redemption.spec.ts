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
const POS_REWARD = "UD2468";
const VOUCHER_REWARD = "UD3579";
const USED_ELSEWHERE = "UD1111";
const MEMBER_PHONE = "0900001234";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(NOON);
	await watchMiniAppPage(page);
});

async function checkScreen(page: Page): Promise<void> {
	await expectOnePrimaryAction(page);
	await checkMiniAppScreen(page);
}

async function openTool(page: Page, name: string): Promise<void> {
	await page.goto("./?role=staff");
	await page.getByTestId("home-loyalty").getByRole("button", { name }).click();
	await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

async function checkCode(page: Page, code: string): Promise<void> {
	await page.getByTestId("redeem-code").fill(code);
	await page.getByRole("button", { name: "Kiểm tra" }).click();
}

test("a valid code shows the POS discount to choose and stays pending until the invoice syncs", async ({
	page,
}) => {
	await openTool(page, "Kiểm tra ưu đãi");
	await checkScreen(page);
	await page.getByTestId("redeem-code").fill(POS_REWARD);
	await watchResultModal(page);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Kiểm tra" }).click(),
	);
	await expect(page.getByTestId("result-modal")).toHaveText(/Mã hợp lệ/);
	await expectResultModalClosed(page);
	const instruction = page.getByTestId("redeem-instruction");
	await expect(instruction).toHaveAttribute("data-kind", "pos_discount");
	await expect(instruction).toContainText(
		"Trên máy POS, ở bước thanh toán, chọn chiết khấu có tên:",
	);
	await expect(page.getByTestId("redeem-apply")).toHaveText(
		"Thành viên - Tặng 1 ly",
	);
	await expect(page.getByTestId("redeem-state")).toHaveText(
		"Đang chờ xác nhận",
	);
	await checkScreen(page);
});

test("a reused code is refused with the store and time, never the customer", async ({
	page,
}) => {
	await openTool(page, "Kiểm tra ưu đãi");
	await checkCode(page, POS_REWARD);
	await expect(page.getByTestId("redeem-instruction")).toBeVisible();
	await expect(page.getByTestId("result-modal")).toHaveCount(0, {
		timeout: 3000,
	});
	await page.getByRole("button", { name: "Kiểm tra mã khác" }).click();
	await checkCode(page, POS_REWARD);
	const refused = page.getByTestId("redeem-refused");
	await expect(refused).toHaveAttribute("data-refusal", "used");
	await expect(refused).toContainText("Mã đã được sử dụng");
	await expect(refused).toContainText(
		"Đã dùng lúc 12:00 ngày 19/11/2026 tại Cửa hàng Mẫu 1.",
	);
	await expect(refused).not.toContainText("•");
	await expect(page.getByTestId("redeem-instruction")).toHaveCount(0);
	await checkScreen(page);
	await checkCode(page, USED_ELSEWHERE);
	await expect(refused).toContainText(
		"Đã dùng lúc 09:15 ngày 19/11/2026 tại Cửa hàng Mẫu 2.",
	);
	await checkScreen(page);
});

test("a CRM voucher code is given to type on the total screen", async ({
	page,
}) => {
	await openTool(page, "Kiểm tra ưu đãi");
	await checkCode(page, VOUCHER_REWARD);
	await expect(page.getByTestId("redeem-instruction")).toHaveAttribute(
		"data-kind",
		"voucher_code",
	);
	await expect(page.getByTestId("redeem-apply")).toHaveText("VC8F3K2Q");
	await expect(page.getByTestId("redeem-min-bill")).toHaveText(
		/^Áp dụng cho hóa đơn từ 50\.000\s₫\.$/,
	);
	await checkScreen(page);
});

test("member lookup shows a masked card and today's visits at this store", async ({
	page,
}) => {
	await openTool(page, "Tra cứu thành viên");
	await checkScreen(page);
	await page.getByTestId("lookup-phone").fill(MEMBER_PHONE);
	await expectFeedbackWithin(page, () =>
		page.getByRole("button", { name: "Tra cứu" }).click(),
	);
	await expect(page.getByTestId("member-phone")).toHaveText("•••• ••• 234");
	await expect(page.getByTestId("member-stamps")).toHaveText("5/8");
	await expect(
		page.getByRole("heading", { name: "Hôm nay tại Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await expect(page.getByTestId("visit")).toHaveCount(1);
	await expect(page.getByTestId("visit")).toContainText(
		"08:40 · Mã thành viên",
	);
	await expect(page.locator("body")).not.toContainText(MEMBER_PHONE);
	await checkScreen(page);
});
