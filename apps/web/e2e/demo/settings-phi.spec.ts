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
import {
	openTheme,
	themeCard,
	waitForSettledThemeCards,
} from "../support/themes";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const NO_RELOAD_MARKER = "phiSameDocument";
const FIRST_DAY = "2023-01-01";
const TODAY = "2026-11-04";
const ESTABLISHED = "MOCK-S1";
const WALLET = "PM-EWALLET";
const WALLET_NAME = "Ví điện tử QR";
const CASH = "PM-CASH";
const WHOLE_HISTORY = "Áp dụng cho toàn bộ lịch sử bán.";
const KEEPS_EARLIER = "Từ ngày này trở đi; các ngày trước giữ mức phí cũ.";
const CATCH_UP_NOTE =
	"Ước tính phí của các ngày đã qua sẽ được tính lại theo mức phí này.";

function feeRow(page: Page, methodId: string): Locator {
	return page.locator(`[data-testid="fee-row"][data-method="${methodId}"]`);
}

function percentField(row: Locator): Locator {
	return row.getByLabel(/^Tỷ lệ phí mới cho /);
}

function fixedField(row: Locator): Locator {
	return row.getByLabel(/^Phí cố định mỗi lần cho /);
}

function dateField(row: Locator): Locator {
	return row.getByLabel(/^Áp dụng từ ngày cho /);
}

function scopeField(page: Page): Locator {
	return page.getByLabel("Áp dụng cho", { exact: true });
}

function saveBar(page: Page): Locator {
	return page.getByTestId("settings-save-bar");
}

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
}

async function markThisDocument(page: Page): Promise<void> {
	await page.evaluate(
		(marker) => Reflect.set(window, marker, true),
		NO_RELOAD_MARKER,
	);
}

async function expectSameDocument(page: Page): Promise<void> {
	expect(
		await page.evaluate(
			(marker) => Reflect.get(window, marker),
			NO_RELOAD_MARKER,
		),
	).toBe(true);
}

async function openFees(page: Page): Promise<void> {
	await openSettings(page, "du-lieu-nhap-tay", "tab=phi");
	await expect(page.getByTestId("fees-form")).toBeVisible();
}

async function openPaymentsThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Chủ đề" }).click();
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Thanh toán & tiền mặt" })
		.click();
	await expect(page).toHaveURL(/#\/chu-de\/thanh-toan/);
	await waitForSettledThemeCards(page);
}

function feesTableRow(page: Page, method: string): Locator {
	return themeCard(page, "payments", "fees")
		.getByRole("table", { name: "Phí theo phương thức thanh toán" })
		.locator("tbody tr")
		.filter({ hasText: method });
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("with Thanh toán open, a fee rate for the e-wallet entered with its default date 01/01/2023 brings the fee estimate after an in-app navigation", async ({
	page,
}) => {
	await openTheme(page, "payments");
	await markThisDocument(page);
	const fees = themeCard(page, "payments", "fees");
	await expect(fees.getByTestId("headline")).toHaveText("—");
	await fees.getByTestId("card-notice").getByRole("link").click();
	await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=phi/);
	await expectCurrentSettingsPage(page, "Dữ liệu nhập tay");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Phí thanh toán");
	await expect(scopeField(page)).toHaveValue("all");
	const kinds = page.getByTestId("fee-kind");
	await expect(kinds.getByRole("heading", { level: 3 })).toHaveText([
		"Tiền mặt",
		"Ví điện tử",
		"Chuyển khoản",
	]);
	const wallet = feeRow(page, WALLET);
	await expect(
		page.locator('[data-testid="fee-kind"][data-kind="ewallet"]'),
	).toContainText(WALLET_NAME);
	await expect(wallet.getByTestId("fee-current")).toHaveText(
		"Chưa có mức phí.",
	);
	await expect(dateField(wallet)).toHaveValue(FIRST_DAY);
	await expect(dateField(wallet)).toHaveAccessibleDescription(WHOLE_HISTORY);
	await expect(percentField(wallet)).toHaveAttribute("inputmode", "decimal");
	await expect(percentField(wallet)).toHaveAccessibleName(
		`Tỷ lệ phí mới cho ${WALLET_NAME}`,
	);
	await expect(fixedField(wallet)).toHaveAccessibleName(
		`Phí cố định mỗi lần cho ${WALLET_NAME}`,
	);
	await expect(dateField(wallet)).toHaveAccessibleName(
		`Áp dụng từ ngày cho ${WALLET_NAME}`,
	);
	await expect(fixedField(wallet)).toHaveAttribute("inputmode", "numeric");
	await percentField(wallet).fill("1,1");
	await percentField(wallet).blur();
	await expect(percentField(wallet)).toHaveValue("1,1");
	await saveSettings(saveBar(page));
	await expect(page.getByTestId("fees-catch-up-note")).toHaveText(
		CATCH_UP_NOTE,
	);
	await expect(page.getByTestId("fees-catch-up-note")).toHaveAttribute(
		"role",
		"status",
	);
	await expect(wallet.getByTestId("fee-current")).toHaveText(
		"Phí hôm nay: 1,1%, từ 01/01/2023",
	);
	await expect(wallet.getByTestId("settings-audit-line").first()).toContainText(
		"Bạn sửa lần cuối",
	);
	await expect(dateField(wallet)).toHaveValue(TODAY);
	await expect(dateField(wallet)).toHaveAccessibleDescription(KEEPS_EARLIER);

	await openPaymentsThroughTheApp(page);
	const after = themeCard(page, "payments", "fees");
	await expect(after.getByTestId("card-notice")).toHaveCount(0);
	await expect(after.getByTestId("headline")).toHaveText(/\d.*₫/);
	await expect(feesTableRow(page, WALLET_NAME)).toContainText("1,1%");
	await expect(feesTableRow(page, "Tiền mặt")).toContainText("0,0%");
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("a 21 % fee, more than three decimals and a fixed fee above 100.000 ₫ are refused before anything is sent", async ({
	page,
}) => {
	await openFees(page);
	const wallet = feeRow(page, WALLET);
	const errors = wallet.getByTestId("settings-field-error");
	await percentField(wallet).fill("21");
	await expect(errors).toHaveText(["Nhập giá trị từ 0% đến 20%."]);
	await expect(page.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	await percentField(wallet).fill("1,1255");
	await expect(errors).toHaveText(["Chỉ nhập tối đa 3 chữ số sau dấu phẩy."]);
	await percentField(wallet).fill("20");
	await fixedField(wallet).fill("100001");
	await expect(errors).toHaveText(["Nhập giá trị không quá 100.000 ₫."]);
	await fixedField(wallet).fill("500,5");
	await expect(errors).toHaveText([
		"Nhập số tiền chẵn đồng, không có phần lẻ.",
	]);
	await expect(scopeField(page)).toBeDisabled();
	await page.getByTestId("settings-save").click({ force: true });
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await page.getByTestId("settings-cancel").click();
	await expect(percentField(wallet)).toHaveValue("");
	await expect(errors).toHaveCount(0);
	await expect(wallet.getByTestId("fee-current")).toHaveText(
		"Chưa có mức phí.",
	);
	await expect(page.getByTestId("fees-catch-up-note")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("a later rate starts today and keeps the earlier days, a store's own rate replaces the shared one only when dated back, and the form says which days each covers", async ({
	page,
}) => {
	await openFees(page);
	const cash = feeRow(page, CASH);
	await percentField(cash).fill("0,5");
	await saveSettings(saveBar(page));
	await expect(dateField(cash)).toHaveValue(TODAY);
	await percentField(cash).fill("0,8");
	await fixedField(cash).fill("200");
	await saveSettings(saveBar(page));
	await expect(cash.getByTestId("fee-current")).toHaveText(
		/^Phí hôm nay: 0,8% cộng 200\s₫ mỗi lần thanh toán, từ 04\/11\/2026$/,
	);
	const toggle = cash.getByTestId("fee-history-toggle");
	await expect(toggle).toHaveText("Lịch sử phí (2)");
	await toggle.click();
	const history = cash.getByTestId("fee-history-row");
	await expect(history.nth(0)).toContainText("Từ 04/11/2026:");
	await expect(history.nth(0)).toContainText("đang áp dụng");
	await expect(history.nth(1)).toContainText("Từ 01/01/2023: 0,5%");
	await dateField(cash).fill("2026-06-01");
	await expect(dateField(cash)).toHaveAccessibleDescription(
		"Từ ngày này đến hết 03/11/2026; các ngày trước giữ mức phí cũ.",
	);
	await dateField(cash).fill(FIRST_DAY);
	await expect(dateField(cash)).toHaveAccessibleDescription(
		"Thay mức phí đang có từ đúng ngày này.",
	);
	await page.getByTestId("settings-cancel").click();

	await scopeField(page).selectOption(ESTABLISHED);
	const inStore = feeRow(page, CASH);
	await expect(inStore.getByTestId("fee-current")).toContainText(
		"theo Tất cả cửa hàng",
	);
	await expect(dateField(inStore)).toHaveValue(TODAY);
	await expect(dateField(inStore)).toHaveAccessibleDescription(
		"Từ ngày này trở đi; các ngày trước giữ mức phí chung.",
	);
	await dateField(inStore).fill(FIRST_DAY);
	await expect(dateField(inStore)).toHaveAccessibleDescription(
		"Thay mức phí chung ở cửa hàng này từ ngày này trở đi, kể cả các ngày đã qua.",
	);
	await percentField(inStore).fill("0,6");
	await saveSettings(saveBar(page));
	await expect(inStore.getByTestId("fee-current")).toHaveText(
		"Phí hôm nay: 0,6%, từ 01/01/2023",
	);
	expectNoConsoleErrors(page);
});

test("Phí thanh toán passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openFees(page);
	await percentField(feeRow(page, WALLET)).fill("21");
	await checkPage(page);
	await page.getByTestId("settings-cancel").click();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Manual data");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Payment fees");
	await expect(page.getByTestId("fees-form")).toContainText("New fee rate");
	await expect(page.getByTestId("fees-form")).toContainText("E-wallet");
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
