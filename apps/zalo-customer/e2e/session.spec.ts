import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

test("the owner sees Đang kết nối…, then the name, role and stores", async ({
	page,
}) => {
	await page.goto("./?delay=800");
	await expect(page.getByRole("status")).toHaveText("Đang kết nối…");
	await expect(
		page.getByRole("heading", { name: "Xin chào, Chủ cửa hàng thử" }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText("Chủ cửa hàng");
	await expect(
		page.getByTestId("member-stores").getByRole("listitem"),
	).toHaveText(["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"]);
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkMiniAppScreen(page);
});

test("an unpaired member sees the instructions and links with a code", async ({
	page,
}) => {
	await page.goto("./?session=unpaired");
	await expect(
		page.getByRole("heading", { name: "Tài khoản chưa được liên kết" }),
	).toBeVisible();
	await checkMiniAppScreen(page);
	await page.getByLabel("Mã liên kết").fill("123456");
	await page.getByRole("button", { name: "Liên kết" }).click();
	await expect(
		page.getByRole("heading", { name: "Xin chào, Chủ cửa hàng thử" }),
	).toBeVisible();
	await checkMiniAppScreen(page);
});

test("a Testing build has no probe screen", async ({ page }) => {
	await page.goto("./");
	await expect(
		page.getByRole("heading", { name: "Xin chào, Chủ cửa hàng thử" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Kiểm tra quyền số điện thoại" }),
	).toHaveCount(0);
	await expect(page.getByTestId("phone-probe")).toHaveCount(0);
});
