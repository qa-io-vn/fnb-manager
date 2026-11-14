import { join } from "node:path";
import { expect, test } from "@playwright/test";

const SCREENSHOTS = join(process.cwd(), "..", "..", "docs", "user-guide");
const PHONE = { width: 390, height: 844 };

test("the sign-in and forgotten-password screens on a phone", async ({
	page,
}) => {
	await page.setViewportSize(PHONE);
	await page.goto("/");
	await expect(
		page.getByRole("button", { name: "Đăng nhập", exact: true }),
	).toBeVisible();
	await page.screenshot({
		path: join(SCREENSHOTS, "sign-in-phone.png"),
		animations: "disabled",
	});
	await page.getByRole("link", { name: "Quên mật khẩu?" }).click();
	await expect(
		page.getByRole("button", { name: "Gửi liên kết" }),
	).toBeVisible();
	await page.screenshot({
		path: join(SCREENSHOTS, "forgot-password-phone.png"),
		animations: "disabled",
	});
});
