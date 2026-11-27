// Regression of the build without VITE_ORDERING (every build that may go to Zalo's review until the Checkout SDK is
// integrated, ADR-058): the loyalty app as it was. A table's QR opens the store page as any store link did, the bar
// has the three tabs it had, no price shows anywhere, and the ordering screens and the demo till are not in the build.
import { expect, test } from "@playwright/test";
import {
	checkCustomerScreen,
	PROGRAMME,
	watchCustomerPage,
} from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

test("without the ordering flag a table's QR opens the store page and nothing can be ordered", async ({
	page,
}) => {
	await page.goto("./?store=mau-1&src=table&t=demo-table-12");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await expect(page.getByTestId("ordering-menu")).toHaveCount(0);
	await expect(
		page
			.getByRole("navigation")
			.getByText(/^(Trang chủ|Thẻ thành viên|Tài khoản)$/),
	).toHaveCount(3);
	await expect(page.getByRole("navigation").getByText("Thực đơn")).toHaveCount(
		0,
	);
	await checkCustomerScreen(page);
	expect(await page.evaluate(() => "__FNB_DEMO_TILL__" in window)).toBe(false);
	await page.getByRole("button", { name: "Quay lại" }).click();
	await expect(page.getByRole("heading", { name: PROGRAMME })).toBeVisible();
	await checkCustomerScreen(page);
});
