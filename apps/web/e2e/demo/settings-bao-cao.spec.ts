import { checkPage } from "../support/checks";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	reportUrl,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	saveSettings,
} from "../support/settings";
import {
	expectCsvTablesWithBom,
	expectSemicolonCsv,
	openTheme,
	themeCard,
} from "../support/themes";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const AMOUNT = "Chênh lệch két theo số tiền";
const WINDOW_DAYS = "Số ngày xét thực đơn";
const FEWEST_ITEMS = "Số món tối thiểu mỗi vai trò";

function thresholdsForm(page: Page): Locator {
	return page.getByTestId("thresholds-form");
}

function field(page: Page, label: string): Locator {
	return thresholdsForm(page).getByLabel(label, { exact: true });
}

async function openThresholds(page: Page): Promise<void> {
	await openSettings(page, "bao-cao");
	await expect(thresholdsForm(page)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Ngưỡng báo cáo shows every threshold with its default and refuses a value out of range", async ({
	page,
}) => {
	await openThresholds(page);
	await expectCurrentSettingsPage(page, "Ngưỡng báo cáo");
	await expect(page.getByTestId("thresholds-note")).toContainText(
		"bản tin ngày",
	);
	await expect(field(page, WINDOW_DAYS)).toHaveValue("28");
	await expect(field(page, "Ngưỡng bán chạy")).toHaveValue("70");
	await expect(field(page, "Số món tối thiểu mỗi vai trò")).toHaveValue("10");
	await expect(field(page, AMOUNT)).toHaveValue("50.000");
	await expect(field(page, "Chênh lệch két theo tỷ lệ")).toHaveValue("0,5");
	await expect(field(page, "Số giờ cao điểm")).toHaveValue("3");
	await expect(field(page, "Ngưỡng giờ thấp điểm")).toHaveValue("50");
	await expect(field(page, "Ngưỡng giờ đông")).toHaveValue("125");
	await expect(field(page, "Số tuần trước khuyến mãi")).toHaveValue("4");
	await expect(thresholdsForm(page)).toContainText("Mặc định: 28 ngày.");
	await expect(thresholdsForm(page)).toContainText("Mặc định: 4 tuần.");
	await expect(page.getByTestId("thresholds-z-fixed")).toContainText(
		"cố định ở mức 2",
	);
	await expect(page.getByTestId("settings-audit-line")).toHaveText(
		"Đang dùng giá trị mặc định.",
	);
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"Chưa có thay đổi.",
	);
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await field(page, WINDOW_DAYS).fill("5");
	await field(page, WINDOW_DAYS).blur();
	await expect(
		thresholdsForm(page).getByTestId("settings-field-error"),
	).toHaveText("Nhập giá trị từ 7 đến 91.");
	await expect(page.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	await page.getByTestId("settings-cancel").click();
	await expect(field(page, WINDOW_DAYS)).toHaveValue("28");
	expectNoConsoleErrors(page);
});

test("saved thresholds show again with who changed them, move the reports, and restoring the defaults removes them", async ({
	page,
}) => {
	await openThresholds(page);
	await field(page, AMOUNT).fill("80000");
	await field(page, AMOUNT).blur();
	await expect(field(page, AMOUNT)).toHaveValue("80.000");
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await field(page, FEWEST_ITEMS).fill("50");
	await field(page, FEWEST_ITEMS).blur();
	await field(page, "Chênh lệch két theo tỷ lệ").fill("0,25");
	await field(page, "Ngưỡng bán chạy").fill("65");
	await field(page, "Ngưỡng bán chạy").blur();
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"4 thay đổi chưa lưu",
	);
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(page.getByTestId("settings-audit-line")).toContainText(
		"Bạn sửa lần cuối 04/11/2026",
	);
	await expect(field(page, AMOUNT)).toHaveValue("80.000");
	await openTheme(page, "payments");
	const drawer = themeCard(page, "payments", "drawer");
	await expect(drawer).toContainText(/Ngưỡng: 80\.000\s₫ · 0,25% tiền mặt bán/);
	await openTheme(page, "menu");
	const matrix = themeCard(page, "menu", "menu_matrix");
	await expect(matrix).toContainText("ít hơn 50 món");
	await expect(matrix).toContainText("hệ số phổ biến 0,65");
	await openThresholds(page);
	await expect(field(page, AMOUNT)).toHaveValue("80.000");
	await page.getByTestId("settings-restore-defaults").click();
	await expect(field(page, AMOUNT)).toHaveValue("50.000");
	await expect(field(page, FEWEST_ITEMS)).toHaveValue("10");
	await saveSettings(page.getByTestId("settings-save-bar"));
	await expect(page.getByTestId("settings-audit-line")).toHaveText(
		"Đang dùng giá trị mặc định.",
	);
	await openTheme(page, "payments");
	await expect(drawer).toContainText(/Ngưỡng: 50\.000\s₫ · 0,5% tiền mặt bán/);
	await openTheme(page, "menu");
	await expect(matrix).not.toContainText("ít hơn 50 món");
	await expect(matrix).toContainText("hệ số phổ biến 0,7");
	expectNoConsoleErrors(page);
});

test("this device switches its CSV downloads to semicolons, keeps the choice over a reload, and switches back", async ({
	page,
}) => {
	await openThresholds(page);
	await expect(page.getByTestId("csv-dialect-comma")).toBeChecked();
	await page.getByTestId("csv-dialect-semicolon").check();
	await openTheme(page, "revenue");
	await expectSemicolonCsv(page, themeCard(page, "revenue", "store_share"));
	await page.goto(reportUrl("day"));
	await waitForSettledCards(page);
	await expectSemicolonCsv(page, page.getByTestId("card-day-top_items"));
	await page.reload();
	await openThresholds(page);
	await expect(page.getByTestId("csv-dialect-semicolon")).toBeChecked();
	await page.getByTestId("csv-dialect-comma").check();
	await openTheme(page, "revenue");
	await expectCsvTablesWithBom(page, themeCard(page, "revenue", "store_share"));
	expectNoConsoleErrors(page);
});

test("a field reached with the keyboard on a phone is never hidden behind the save bar or the top bar", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 640 });
	await openThresholds(page);
	const fields = thresholdsForm(page).getByRole("textbox");
	const count = await fields.count();
	expect(count).toBe(9);
	await fields.first().focus();
	for (let index = 0; index < count; index += 1) {
		const focused = fields.nth(index);
		await expect(focused).toBeFocused();
		await expect
			.poll(async () => {
				const box = await focused.boundingBox();
				const bar = await page.getByTestId("settings-save-bar").boundingBox();
				const top = await page.locator("header").first().boundingBox();
				if (box === null || bar === null || top === null) return "missing";
				if (box.y + box.height > bar.y) return "behind the save bar";
				if (box.y < top.y + top.height) return "behind the top bar";
				return "in view";
			})
			.toBe("in view");
		await page.keyboard.press("Tab");
	}
});

test("Ngưỡng báo cáo passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openThresholds(page);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Report thresholds");
	await expect(field(page, "Menu window")).toHaveValue("28");
	await expect(thresholdsForm(page)).toContainText("Default: 28 days.");
	await expect(
		page.getByRole("radio", { name: "Comma (default)" }),
	).toBeChecked();
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
