import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	saveSettings,
} from "../support/settings";
import { openTheme, themeCard } from "../support/themes";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const ESTABLISHED = "MOCK-S1";
const YOUNG = "MOCK-S2";

function storeBlock(page: Page, storeId: string): Locator {
	return page.locator(`[data-testid="store-profile"][data-store="${storeId}"]`);
}

function tenantBlock(page: Page): Locator {
	return page.getByTestId("tenant-profile");
}

async function openStores(page: Page): Promise<void> {
	await openSettings(page, "cua-hang");
	await expect(storeBlock(page, YOUNG)).toBeVisible();
	await expect(
		storeBlock(page, ESTABLISHED).getByTestId("settings-save-bar"),
	).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Cửa hàng shows the business and every store, with the POS facts read-only and the demo note", async ({
	page,
}) => {
	await openStores(page);
	await expectCurrentSettingsPage(page, "Cửa hàng");
	await expect(page.getByTestId("settings-demo-note")).toContainText(
		"thay đổi chỉ giữ trong phiên này",
	);
	await expect(tenantBlock(page).getByLabel("Loại hình pháp lý")).toHaveValue(
		"household_business",
	);
	await expect(tenantBlock(page).getByLabel("Ngôn ngữ mặc định")).toHaveValue(
		"vi",
	);
	await expect(page.getByTestId("store-profile")).toHaveCount(2);
	for (const storeId of [ESTABLISHED, YOUNG]) {
		const facts = storeBlock(page, storeId).getByTestId("store-pos-facts");
		await expect(facts.getByTestId("store-from-pos")).toHaveCount(4);
		await expect(facts.locator("input, select, textarea")).toHaveCount(0);
		await expect(facts.getByTestId("store-pos-day-start")).toContainText(
			"00:00",
		);
	}
	const young = storeBlock(page, YOUNG);
	await expect(young.getByLabel("Mã cửa hàng")).toHaveValue("CH2");
	await expect(young.getByLabel("Số ghế")).toHaveValue("");
	await expect(young.getByLabel("Hóa đơn điện tử")).toHaveValue(
		"not_configured",
	);
	await expect(young.getByTestId("opening-hours-editor")).toContainText(
		"Lưu giờ mở cửa sẽ đổi Giờ & ngày",
	);
	await expect(young.getByTestId("settings-audit-line")).toHaveText(
		"Chưa lưu lần nào.",
	);
	await expect(page.getByTestId("store-profiles")).toHaveAttribute(
		"data-receipt-suggestions",
		"settled",
	);
	await expect(page.getByTestId("store-receipts-apply")).toHaveCount(0);
	await expect(page.getByTestId("store-page")).not.toContainText(
		"Gợi ý từ dữ liệu",
	);
	expectNoConsoleErrors(page);
});

test("an incomplete opening span and another store's code are refused with their messages", async ({
	page,
}) => {
	await openStores(page);
	const established = storeBlock(page, ESTABLISHED);
	await established
		.getByRole("button", { name: "Thêm khung giờ cho Thứ Hai" })
		.click();
	await expect(established.getByTestId("opening-hours-mon")).toContainText(
		"Nhập giờ dạng giờ:phút, ví dụ 07:00.",
	);
	await expect(established.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(established.getByTestId("settings-save-bar-status")).toHaveText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	await established.getByTestId("settings-cancel").click();
	await expect(established.getByTestId("settings-save-bar-pending")).toHaveText(
		"Chưa có thay đổi.",
	);
	const young = storeBlock(page, YOUNG);
	await young.getByLabel("Mã cửa hàng").fill("ch1");
	await young.getByRole("button", { name: "Lưu" }).click();
	await expect(young.getByTestId("settings-save-bar-status")).toHaveText(
		"Không lưu được: mã này đã dùng cho một cửa hàng khác của chuỗi.",
	);
	await expect(young.getByTestId("settings-field-error")).toContainText(
		"mã này đã dùng cho một cửa hàng khác của chuỗi",
	);
	await young.getByTestId("settings-cancel").click();
	await expect(young.getByLabel("Mã cửa hàng")).toHaveValue("CH2");
	expectNoConsoleErrors(page);
});

test("opening hours and seats saved for the young store bring its per-hour figures and RevPASH to Giờ & ngày", async ({
	page,
}) => {
	await openTheme(page, "hours", `range=28d&store=${YOUNG}`);
	const productivity = themeCard(page, "hours", "productivity");
	await expect(productivity.getByTestId("headline")).toHaveText("—");
	await productivity
		.getByTestId("card-notice")
		.getByRole("link", { name: "Nhập giờ mở cửa và số ghế" })
		.click();
	await expectCurrentSettingsPage(page, "Cửa hàng");
	const young = storeBlock(page, YOUNG);
	await expect(young.getByTestId("settings-save-bar")).toBeVisible();
	await young.getByLabel("Số ghế").fill("30");
	await young
		.getByRole("checkbox", { name: "Thứ Hai, nghỉ cả ngày" })
		.uncheck();
	await young
		.getByRole("button", { name: "Thứ Hai: chép sang các ngày khác" })
		.click();
	await expect(young.getByTestId("settings-save-bar-pending")).toHaveText(
		"2 thay đổi chưa lưu",
	);
	await saveSettings(young.getByTestId("settings-save-bar"));
	await expect(young.getByTestId("settings-audit-line")).toContainText(
		"Bạn sửa lần cuối 04/11/2026",
	);
	await expect(young.getByLabel("Số ghế")).toHaveValue("30");
	await expect(
		young.getByRole("checkbox", { name: "Chủ Nhật, nghỉ cả ngày" }),
	).not.toBeChecked();
	await page.goBack();
	await expect(productivity.getByTestId("headline")).toHaveText(/\d/);
	await expect(productivity).toContainText(
		/Doanh thu mỗi ghế mỗi giờ \(RevPASH\) là .+ với 30 ghế\./,
	);
	await expect(productivity.getByTestId("card-notice")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("saving English as the business's default switches a session that never chose a language, and the language switch still wins", async ({
	page,
}) => {
	await openStores(page);
	const tenant = tenantBlock(page);
	await tenant.getByLabel("Loại hình pháp lý").selectOption("micro_enterprise");
	await tenant.getByLabel("Ngôn ngữ mặc định").selectOption("en");
	await expect(tenant.getByTestId("settings-save-bar-pending")).toHaveText(
		"2 thay đổi chưa lưu",
	);
	await tenant.getByRole("button", { name: "Lưu" }).click();
	await expectCurrentSettingsPage(page, "Stores");
	await expect(tenant.getByLabel("Legal form")).toHaveValue("micro_enterprise");
	await expect(tenant.getByLabel("Default language")).toHaveValue("en");
	await expect(tenant.getByTestId("settings-audit-line")).toContainText(
		"You last changed this on 04/11/2026",
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await expectCurrentSettingsPage(page, "Cửa hàng");
	await openTheme(page, "revenue");
	await expect(
		page.getByRole("heading", { level: 1, name: "Doanh thu & xu hướng" }),
	).toBeVisible();
	expectNoConsoleErrors(page);
});

test("Cửa hàng passes axe at 360 and 1280 px and reads in English without raw keys", async ({
	page,
}) => {
	await openStores(page);
	await checkPage(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await expect(storeBlock(page, YOUNG)).toBeVisible();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Stores");
	await expect(tenantBlock(page)).toContainText("Legal form");
	await expect(storeBlock(page, YOUNG)).toContainText("from the POS");
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
