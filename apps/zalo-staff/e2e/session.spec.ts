import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

test("a bound member sees Đang kết nối…, then the name, role and stores", async ({
	page,
}) => {
	await page.goto("./?delay=800");
	await expect(page.getByRole("status")).toHaveText("Đang kết nối…");
	await expect(
		page.getByRole("heading", { name: "Xin chào, Thành viên thử" }),
	).toBeVisible();
	await expect(page.getByTestId("member-role")).toHaveText("Quản lý");
	await expect(page.getByLabel("Cửa hàng").locator("option")).toHaveText([
		"Cửa hàng Mẫu 1",
		"Cửa hàng Mẫu 2",
	]);
	await expect(page.getByTestId("stand-in-header")).toBeVisible();
	await checkMiniAppScreen(page);
});

test("an unpaired person sees only the entry screens and pairs with a code", async ({
	page,
}) => {
	await page.goto("./?session=unpaired");
	await expect(
		page.getByRole("heading", { name: "Ứng dụng nội bộ cho nhân viên" }),
	).toBeVisible();
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkMiniAppScreen(page);
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page.getByRole("button", { name: "Đồng ý" }).click();
	const code = page.getByLabel("Mã ghép nối");
	await code.fill("000000");
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(page.getByRole("alert")).toContainText("Mã không đúng");
	await expect(page.getByRole("navigation")).toHaveCount(0);
	await checkMiniAppScreen(page);
	await code.fill("123456");
	await page.getByRole("button", { name: "Ghép nối" }).click();
	await expect(
		page.getByRole("heading", { name: "Xin chào, Thành viên thử" }),
	).toBeVisible();
	await checkMiniAppScreen(page);
});

test("a failed connection shows one retry action", async ({ page }) => {
	await page.goto("./?session=failed");
	await expect(
		page.getByRole("heading", { name: "Chưa kết nối được" }),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Thử lại" })).toHaveCount(1);
	await checkMiniAppScreen(page);
});

test("the first of four tabs opens first, Ca làm shows the shift and Thông báo the notices", async ({
	page,
}) => {
	await page.goto("./");
	const navigation = page.getByRole("navigation", { name: "Điều hướng chính" });
	await expect(navigation.getByRole("button")).toHaveText([
		"Trang chủ",
		"Ca làm",
		"Thông báo",
		"Cá nhân",
	]);
	await expect(
		page.getByRole("heading", { name: "Xin chào, Thành viên thử" }),
	).toBeVisible();
	await navigation.getByRole("button", { name: "Ca làm" }).click();
	await expect(page.getByTestId("shift-board")).toBeVisible();
	await checkMiniAppScreen(page);
	await navigation.getByRole("button", { name: "Thông báo" }).click();
	await expect(page.getByTestId("notices-list")).toBeVisible();
	await checkMiniAppScreen(page);
	await navigation.getByRole("button", { name: "Cá nhân" }).click();
	await expect(page.getByTestId("profile")).toBeVisible();
	await checkMiniAppScreen(page);
});

test("English follows Zalo's language", async ({ page }) => {
	await page.goto("./?lang=en");
	await expect(
		page.getByRole("heading", { name: "Hello, Thành viên thử" }),
	).toBeVisible();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await checkMiniAppScreen(page);
});
