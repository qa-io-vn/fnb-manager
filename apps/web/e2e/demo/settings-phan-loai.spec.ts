import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	saveSettings,
} from "../support/settings";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const TOPPING_TYPES = ["TYPE-007", "TYPE-008"] as const;

function rolesForm(page: Page): Locator {
	return page.getByTestId("roles-form");
}

function roleOf(page: Page, typeId: string): Locator {
	return rolesForm(page)
		.locator(`[data-testid="role-row"][data-type="${typeId}"]`)
		.locator('select[data-testid="role-select"]');
}

async function openRoles(page: Page): Promise<void> {
	await openSettings(page, "phan-loai");
	await expect(rolesForm(page)).toBeVisible();
}

async function openMonthThroughTheApp(page: Page): Promise<Locator> {
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("link", { name: "Báo cáo" })
		.click();
	await page
		.getByTestId("report-tabs")
		.getByRole("link", { name: "Tháng" })
		.click();
	await expect(page).toHaveURL(/#\/bao-cao\/thang/);
	await waitForSettledCards(page);
	return page.getByTestId("card-month-attach_rate");
}

async function setToppingRoles(page: Page, value: string): Promise<void> {
	for (const typeId of TOPPING_TYPES) {
		await roleOf(page, typeId).selectOption(value);
	}
	await saveSettings(page.getByTestId("settings-save-bar"));
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Phân loại lists the demo item types with their roles and their 28-day sales, and shows no catch-up in the demo", async ({
	page,
}) => {
	await openRoles(page);
	await expectCurrentSettingsPage(page, "Phân loại");
	await expect(
		page.getByTestId("mapping-tabs").locator('[aria-current="page"]'),
	).toHaveText("Vai trò nhóm món");
	await expect(rolesForm(page).getByTestId("role-row")).toHaveCount(10);
	await expect(roleOf(page, "TYPE-001")).toHaveValue("drink");
	await expect(roleOf(page, "TYPE-007")).toHaveValue("topping");
	await expect(roleOf(page, "TYPE-009")).toHaveValue("snack");
	await expect(rolesForm(page).locator('[data-type="TYPE-001"]')).toContainText(
		/\d+ món đã bán · [\d,]+% doanh thu món trong 28 ngày/,
	);
	await expect(page.getByTestId("roles-apply-suggestions")).toHaveCount(0);
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Nhóm của món" })
		.click();
	await expect(page).toHaveURL(/tab=nhom-mon/);
	await expect(page.getByTestId("mapping-tab-later")).toContainText("10b");
	expectNoConsoleErrors(page);
});

test("a cleared role gets its suggestion back on request, and nothing is saved before Lưu", async ({
	page,
}) => {
	await openRoles(page);
	await roleOf(page, "TYPE-007").selectOption("");
	await expect(
		rolesForm(page)
			.locator('[data-type="TYPE-007"]')
			.getByTestId("role-suggestion"),
	).toHaveText("Gợi ý: Topping");
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await page.getByTestId("roles-apply-suggestions").click();
	await expect(roleOf(page, "TYPE-007")).toHaveValue("topping");
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"Chưa có thay đổi.",
	);
	await roleOf(page, "TYPE-010").selectOption("food");
	await page.getByTestId("settings-cancel").click();
	await expect(roleOf(page, "TYPE-010")).toHaveValue("other");
	expectNoConsoleErrors(page);
});

test("clearing the topping roles empties Tháng's attach card and restoring them brings the rate back, all through the app's own links", async ({
	page,
}) => {
	await openRoles(page);
	await setToppingRoles(page, "");
	await expect(roleOf(page, "TYPE-007")).toHaveValue("");
	const attach = await openMonthThroughTheApp(page);
	const notice = attach.getByTestId("card-notice");
	await expect(notice).toContainText(
		"Chưa có nhóm món nào mang vai trò topping.",
	);
	await notice.getByRole("link", { name: "Gán vai trò món" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/phan-loai/);
	await expect(rolesForm(page)).toBeVisible();
	await expect(roleOf(page, "TYPE-007")).toHaveValue("");
	await expect(roleOf(page, "TYPE-008")).toHaveValue("");
	await setToppingRoles(page, "topping");
	const restored = await openMonthThroughTheApp(page);
	await expect(restored.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(restored.getByTestId("card-notice")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("Phân loại passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openRoles(page);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Classification");
	await expect(
		page.getByTestId("mapping-tabs").locator('[aria-current="page"]'),
	).toHaveText("Item-type roles");
	await expect(rolesForm(page)).toContainText("items sold");
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
