import {
	checkMiniAppScreen,
	watchMiniAppPage,
} from "@fnb/zalo-mini/testing/design-checks";
import { expect, type Page, test } from "@playwright/test";

const STAMP = /^Cập nhật lúc \d{2}:\d{2}$/;

test.beforeEach(async ({ page }) => {
	await watchMiniAppPage(page);
});

async function homeReady(page: Page): Promise<void> {
	await expect(page.getByTestId("home")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

test("a manager sees today's revenue cards, yesterday's check and the freshness stamp", async ({
	page,
}) => {
	await page.goto("./");
	await homeReady(page);
	await expect(page.getByTestId("member-role")).toHaveText("Quản lý");
	await expect(page.getByTestId("home-freshness")).toHaveText(STAMP);
	await expect(
		page.getByRole("heading", { name: /^Hôm nay đến \d{2}:\d{2} · / }),
	).toBeVisible();
	const net = page.getByTestId("home-net-revenue");
	await expect(net).toHaveText("12,5 tr ₫");
	await expect(page.getByTestId("home-invoices")).toHaveText("186");
	await expect(page.getByTestId("home-card-yesterday")).toContainText(
		"Đã đối soát",
	);
	await expect(page.getByTestId("home-card-opening-hours")).toContainText(
		"07:00–22:00",
	);
	await checkMiniAppScreen(page);

	await net.click();
	await expect(page.getByTestId("home-net-revenue-exact")).toHaveText(
		"Giá trị chính xác: 12.450.000 ₫",
	);
	await page.getByLabel("Cửa hàng").selectOption({ label: "Cửa hàng Mẫu 2" });
	await expect(net).toHaveText("8,3 tr ₫");
	await expect(page.getByTestId("home-invoices")).toHaveText("121");
	await expect(page.getByTestId("home-card-yesterday")).toContainText(
		"Chưa đối soát",
	);
	await checkMiniAppScreen(page);
});

test("staff with store_totals see only today's totals of their store", async ({
	page,
}) => {
	await page.goto("./?role=staff&revenue=store_totals");
	await homeReady(page);
	await expect(page.getByTestId("member-role")).toHaveText("Nhân viên");
	await expect(page.getByTestId("home-store")).toHaveText("Cửa hàng Mẫu 1");
	await expect(page.getByTestId("store-picker")).toHaveCount(0);
	await expect(page.getByTestId("home-net-revenue")).toHaveText("12,5 tr ₫");
	await expect(page.getByTestId("home-invoices")).toHaveText("186");
	await expect(page.getByTestId("home-card-yesterday")).toHaveCount(0);
	await expect(page.getByTestId("home-freshness")).toHaveText(STAMP);
	await checkMiniAppScreen(page);
});

test("staff with none see their store's tasks and the freshness stamp, no revenue", async ({
	page,
}) => {
	await page.goto("./?role=staff&revenue=none");
	await homeReady(page);
	await expect(page.getByTestId("home-card-opening-hours")).toContainText(
		"07:00–22:00",
	);
	await expect(page.getByTestId("home-freshness")).toHaveText(STAMP);
	await expect(page.getByTestId("home-today")).toHaveCount(0);
	await expect(page.getByTestId("home")).not.toContainText("Doanh thu");
	await expect(page.getByTestId("home")).not.toContainText("₫");
	await checkMiniAppScreen(page);
});

test("staff with all see the manager's cards for their store", async ({
	page,
}) => {
	await page.goto("./?role=staff&revenue=all");
	await homeReady(page);
	await expect(page.getByTestId("home-net-revenue")).toHaveText("12,5 tr ₫");
	await expect(page.getByTestId("home-card-yesterday")).toContainText(
		"Đã đối soát",
	);
	await checkMiniAppScreen(page);
});

test("the home shows loading feedback at once, then the figures", async ({
	page,
}) => {
	await page.goto("./?dataDelay=1500");
	await expect(page.getByTestId("home-loading")).toHaveText(
		"Đang tải số liệu…",
	);
	await expect(page.getByRole("status")).toBeVisible();
	await checkMiniAppScreen(page);
	await homeReady(page);
	await expect(page.getByTestId("home-net-revenue")).toHaveText("12,5 tr ₫");
});

test("the home follows Zalo's language", async ({ page }) => {
	await page.goto("./?lang=en");
	await homeReady(page);
	await expect(page.getByTestId("home-net-revenue")).toHaveText("12,5 M ₫");
	await expect(page.getByTestId("home-freshness")).toHaveText(
		/^Updated at \d{2}:\d{2}$/,
	);
	await expect(page.getByText("Opening hours today")).toBeVisible();
	await checkMiniAppScreen(page);
});
