import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	openReport,
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
const NO_RELOAD_MARKER = "mucTieuSameDocument";
const ESTABLISHED = "MOCK-S1";
const YOUNG = "MOCK-S2";
const YOUNG_NAME = "Cửa hàng mẫu 2";
const NOVEMBER = "2026-11-01";
const TARGET = 90_000_000;
const WINDOW = [
	"Tháng 08/2026",
	"Tháng 09/2026",
	"Tháng 10/2026",
	"Tháng 11/2026 · tháng này",
	"Tháng 12/2026",
	"Tháng 01/2027",
];

function money(amount: number): RegExp {
	const grouped = new Intl.NumberFormat("vi-VN").format(amount);
	return new RegExp(`(?<![\\d.])${grouped.replaceAll(".", "\\.")}\\s₫`);
}

function monthCard(page: Page, id: string): Locator {
	return page.getByTestId(`card-month-${id}`);
}

function monthRow(page: Page, monthStart: string): Locator {
	return page.locator(
		`[data-testid="target-month"][data-month="${monthStart}"]`,
	);
}

function amountField(row: Locator): Locator {
	return row.getByLabel(/^Mục tiêu doanh thu thuần cho tháng /);
}

function storeField(page: Page): Locator {
	return page.getByLabel("Cửa hàng", { exact: true });
}

function saveBar(page: Page): Locator {
	return page.getByTestId("settings-save-bar");
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

async function expectPaceReady(row: Locator): Promise<void> {
	await expect(row.getByTestId("target-pace")).toHaveAttribute(
		"data-status",
		"ready",
	);
}

async function openTargets(page: Page): Promise<void> {
	await openSettings(page, "du-lieu-nhap-tay", "tab=muc-tieu");
	await expect(page.getByTestId("targets-form")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test(`with Tháng open for ${YOUNG}, a target saved for this month and the tab's link back show its target progress, the amount still needed each day and both forecasts against the target, through the app's own links`, async ({
	page,
}) => {
	await openReport(page, "month", `month=2026-11&store=${YOUNG}`);
	await markThisDocument(page);
	const before = monthCard(page, "target_progress");
	await expect(before.getByTestId("headline")).toHaveText("—");
	const notice = before.getByTestId("card-notice");
	await expect(notice).toContainText(YOUNG_NAME);
	await notice.getByRole("link", { name: "Đặt mục tiêu tháng" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/du-lieu-nhap-tay\?tab=muc-tieu/);
	await expectCurrentSettingsPage(page, "Dữ liệu nhập tay");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Mục tiêu");
	await expect(page.getByTestId("target-month-label")).toHaveText(WINDOW);
	await storeField(page).selectOption(YOUNG);
	const november = monthRow(page, NOVEMBER);
	await expect(november.getByTestId("target-saved")).toHaveText(
		"Chưa đặt mục tiêu.",
	);
	await expectPaceReady(november);
	await expect(november.getByTestId("target-pace")).toContainText(
		"Doanh thu thuần đến hết 03/11/2026",
	);
	await expect(november.getByTestId("target-pace-net")).toHaveText(/\d\s₫$/);
	await expect(amountField(november)).toHaveAttribute("inputmode", "numeric");
	await expect(amountField(november)).toHaveAccessibleName(
		"Mục tiêu doanh thu thuần cho tháng 11/2026",
	);
	await amountField(november).fill(String(TARGET));
	await amountField(november).blur();
	await expect(amountField(november)).toHaveValue("90.000.000");
	await expect(storeField(page)).toBeDisabled();
	await saveSettings(saveBar(page));
	await expect(november.getByTestId("target-saved")).toHaveText(
		new RegExp(`^Mục tiêu: ${money(TARGET).source}$`),
	);
	await expect(
		november.getByTestId("settings-audit-line").first(),
	).toContainText("Bạn sửa lần cuối");
	await expect(november.getByTestId("target-pace-net")).toContainText(
		"mục tiêu",
	);
	await expect(storeField(page)).toBeEnabled();
	const link = november.getByRole("link", {
		name: "Xem tiến độ trong Báo cáo tháng",
	});
	await expect(link).toHaveAttribute(
		"href",
		`#/bao-cao/thang?month=2026-11&store=${YOUNG}`,
	);
	await link.click();
	await expect(page).toHaveURL(
		new RegExp(`#/bao-cao/thang\\?month=2026-11&store=${YOUNG}$`),
	);
	await waitForSettledCards(page);
	const progress = monthCard(page, "target_progress");
	await expect(progress.getByTestId("card-notice")).toHaveCount(0);
	await expect(progress.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(progress.getByTestId("sentence")).toContainText(
		"mục tiêu tháng 11/2026; cần thêm",
	);
	await expect(progress.getByTestId("sentence")).toContainText(
		"mỗi ngày trong 27 ngày còn lại",
	);
	const chips = progress.getByTestId("comparison-chip");
	await expect(chips).toHaveCount(2);
	await expect(chips.filter({ hasText: "so với mục tiêu" })).toHaveCount(2);
	await expect(
		progress
			.getByRole("table", { name: "Mục tiêu theo cửa hàng" })
			.getByRole("cell", { name: new RegExp(`^${money(TARGET).source}$`) }),
	).toHaveCount(1);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("zero, a fraction of a đồng and an emptied saved target are refused before anything is sent, and the store stays put until the changes are saved or cancelled", async ({
	page,
}) => {
	await openTargets(page);
	await expect(storeField(page)).toHaveValue(ESTABLISHED);
	const november = monthRow(page, NOVEMBER);
	await expect(november.getByTestId("target-saved")).toContainText("Mục tiêu:");
	const saved = await amountField(november).inputValue();
	const december = monthRow(page, "2026-12-01");
	const error = december.getByTestId("settings-field-error");
	await amountField(december).fill("0");
	await expect(error).toHaveText("Nhập giá trị từ 1 ₫ trở lên.");
	await amountField(december).fill("150000000,5");
	await expect(error).toHaveText("Nhập số tiền chẵn đồng, không có phần lẻ.");
	await amountField(december).fill("1000000000000");
	await expect(error).toHaveText("Nhập giá trị không quá 999.999.999.999 ₫.");
	await amountField(december).fill("");
	await amountField(november).fill("");
	await expect(november.getByTestId("settings-field-error")).toHaveText(
		"Ô này không được để trống.",
	);
	await expect(page.getByTestId("settings-save")).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Sửa các ô đang báo lỗi rồi lưu.",
	);
	await expect(storeField(page)).toBeDisabled();
	await expect(storeField(page)).toHaveAccessibleDescription(
		"Lưu hoặc hủy các thay đổi trước khi đổi cửa hàng.",
	);
	await page.getByTestId("settings-save").click({ force: true });
	await expect(page.getByTestId("settings-save-bar-pending")).toHaveText(
		"1 thay đổi chưa lưu",
	);
	await page.getByTestId("settings-cancel").click();
	await expect(amountField(november)).toHaveValue(saved);
	await expect(page.getByTestId("settings-field-error")).toHaveCount(0);
	await expect(storeField(page)).toBeEnabled();
	expectNoConsoleErrors(page);
});

test("Mục tiêu passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openTargets(page);
	await expectPaceReady(monthRow(page, NOVEMBER));
	await amountField(monthRow(page, "2026-12-01")).fill("-1");
	await checkPage(page);
	await page.getByTestId("settings-cancel").click();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Manual data");
	await expect(
		page.getByTestId("manual-tabs").locator('[aria-current="page"]'),
	).toHaveText("Targets");
	await expect(page.getByTestId("targets-form")).toContainText(
		"Net revenue target",
	);
	await expect(monthRow(page, NOVEMBER)).toContainText(
		"See the progress in the monthly report",
	);
	expect(RAW_KEY.test((await page.locator("main").textContent()) ?? "")).toBe(
		false,
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
