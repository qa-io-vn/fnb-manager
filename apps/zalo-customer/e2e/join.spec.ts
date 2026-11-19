import { expect, type Page, test } from "@playwright/test";
import {
	checkCustomerScreen,
	nativeStorageKeys,
	openHome,
	openTab,
	PROGRAMME,
	sdkCall,
	sdkCalls,
	watchCustomerPage,
} from "./customer-checks";

test.beforeEach(async ({ page }) => {
	await watchCustomerPage(page);
});

async function reachConsent(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Tham gia thành viên" }).click();
	await expect(
		page.getByRole("heading", { name: "Tham gia thành viên" }),
	).toBeVisible();
	await checkCustomerScreen(page);
	expect(await sdkCalls(page)).not.toContain("getPhoneNumber");
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(
		page.getByRole("heading", { name: "Đồng ý tham gia" }),
	).toBeVisible();
	await expect(page.getByRole("checkbox")).not.toBeChecked();
	await expect(page.getByRole("switch")).not.toBeChecked();
	await expect(page.getByRole("button", { name: "Tham gia" })).toBeDisabled();
	await checkCustomerScreen(page);
}

test("refusing Zalo's phone permission keeps browsing usable and stores nothing", async ({
	page,
}) => {
	await openHome(page, "?phone=refused");
	await reachConsent(page);
	await page.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await expect(page.getByTestId("declined-notice")).toContainText(
		"Bạn chưa chia sẻ số điện thoại",
	);
	expect(await sdkCalls(page)).toContain("getPhoneNumber");
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: /Cửa hàng Mẫu 1/ }).click();
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 1" }),
	).toBeVisible();
	await openTab(page, "Thẻ thành viên");
	await expect(page.getByTestId("join-prompt")).toBeVisible();
	await checkCustomerScreen(page);
});

test("browse, join with the unticked toggle, then wallet and a receipt claim", async ({
	page,
}) => {
	await openHome(page);
	await reachConsent(page);
	await page.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await expect(
		page.getByRole("heading", { name: "Chào mừng bạn!" }),
	).toBeVisible();
	await expect(page.getByTestId("welcome-stamps")).toHaveText(
		"Bạn nhận được 1 dấu chào mừng.",
	);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Quan tâm" }).click();
	await expect(page.getByTestId("follow-done")).toBeVisible();
	expect(await sdkCall(page, "followOA")).toEqual({ id: "mock-oa-1" });
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await expect(page.getByTestId("member-card")).toBeVisible();
	await expect(page.getByTestId("card-programme")).toHaveText(PROGRAMME);
	await expect(page.getByTestId("stamp-count")).toHaveText("1/10 dấu");
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await page.getByTestId("claim-store").selectOption("mau-1");
	await page.getByTestId("claim-receipt").fill("4321");
	await page.getByTestId("claim-amount").fill("52000");
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Gửi hóa đơn" }).click();
	await expect(page.getByTestId("claim-result")).toHaveAttribute(
		"data-state",
		"pending",
	);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Xem thẻ thành viên" }).click();
	await expect(page.getByTestId("claim-item")).toContainText(
		"Đang chờ xác nhận",
	);
	expect(await nativeStorageKeys(page)).toEqual(["fnb.customer-session"]);
});

test("a promotion consent given at joining is stopped with Dừng nhận tin", async ({
	page,
}) => {
	await openHome(page);
	await reachConsent(page);
	await page.getByRole("checkbox").check();
	await page.getByRole("switch").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await page.getByRole("button", { name: "Bỏ qua" }).click();
	await expect(page.getByTestId("member-card")).toBeVisible();
	await openTab(page, "Tài khoản");
	await expect(page.getByTestId("marketing-state")).toHaveText(
		"Bạn đang nhận tin khuyến mãi qua Zalo.",
	);
	await checkCustomerScreen(page);
	await page.getByRole("button", { name: "Dừng nhận tin" }).click();
	const dialog = page.getByRole("dialog", {
		name: "Dừng nhận tin khuyến mãi?",
	});
	await expect(dialog).toBeVisible();
	await checkCustomerScreen(page);
	await dialog.getByRole("button", { name: "Dừng nhận tin" }).click();
	await expect(page.getByTestId("result-modal")).toHaveText("Đã dừng nhận tin");
	await expect(page.getByTestId("result-modal")).toBeHidden({ timeout: 3000 });
	await expect(page.getByTestId("marketing-state")).toContainText(
		"Bạn không nhận tin khuyến mãi.",
	);
	await expect(page.getByRole("button", { name: "Dừng nhận tin" })).toHaveCount(
		0,
	);
	await checkCustomerScreen(page);
});

test("a visitor who wants to earn from a receipt joins first, then reaches the form", async ({
	page,
}) => {
	await page.goto("./?store=mau-2&src=receipt");
	await expect(
		page.getByRole("heading", { name: "Cửa hàng Mẫu 2" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Nhận điểm từ hóa đơn" }).click();
	await expect(
		page.getByRole("heading", { name: "Nhận điểm từ hóa đơn" }),
	).toBeVisible();
	await page.getByRole("button", { name: "Tiếp tục" }).click();
	await page.getByRole("checkbox").check();
	await page.getByRole("button", { name: "Tham gia" }).click();
	await page.getByRole("button", { name: "Bỏ qua" }).click();
	await expect(page.getByTestId("claim-form")).toBeVisible();
	await expect(page.getByTestId("claim-store")).toHaveValue("mau-2");
	await checkCustomerScreen(page);
});
