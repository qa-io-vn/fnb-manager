import { checkPage } from "../support/checks";
import { expect, type Locator, type Page, test } from "../support/policy-test";
import {
	currentKey,
	expectNoConsoleErrors,
	REPORT_CLOCK,
	waitForSettledCards,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	settingsNav,
} from "../support/settings";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const REPORT_DAY = "2026-11-03";
const SAMPLE_TUESDAY = "2026-10-27";
const DAY_OFF = "Nghỉ sửa quán";
const FULL_BASELINE = "so với mức nền cùng thứ";
const BASELINE_WITHOUT_ONE_WEEK = "so với mức nền (7/8 tuần)";
const NO_RELOAD_MARKER = "ngayLeSameDocument";

function mainNav(page: Page): Locator {
	return page.getByRole("navigation", { name: "Điều hướng chính" });
}

function customSection(page: Page): Locator {
	return page.getByTestId("holidays-custom");
}

function globalSection(page: Page): Locator {
	return page.getByTestId("holidays-global");
}

function netRevenueChips(page: Page): Locator {
	return page
		.getByTestId("card-day-net_revenue")
		.getByTestId("comparison-chip");
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

async function openDayThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Báo cáo" }).click();
	await waitForSettledCards(page);
	expect(currentKey(page, "day")).toBe(REPORT_DAY);
}

async function openHolidaysThroughTheApp(page: Page): Promise<void> {
	await mainNav(page).getByRole("link", { name: "Cài đặt" }).click();
	await settingsNav(page).getByRole("link", { name: "Ngày lễ" }).click();
	await expectCurrentSettingsPage(page, "Ngày lễ");
	await expect(globalSection(page)).toBeVisible();
}

async function addDayOff(page: Page, date: string, name: string) {
	const form = page.getByTestId("holidays-add");
	await form.getByLabel("Ngày", { exact: true }).fill(date);
	await form.getByLabel("Tên", { exact: true }).fill(name);
	await form.getByRole("button", { name: "Thêm" }).click();
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the national days of a year are read-only and labelled by kind, and the year selector covers 2024 to 2030", async ({
	page,
}) => {
	await openSettings(page, "ngay-le");
	await expectCurrentSettingsPage(page, "Ngày lễ");
	const year = page.getByLabel("Năm", { exact: true });
	await expect(year).toHaveValue("2026");
	await expect(year.locator("option")).toHaveText([
		"2024",
		"2025",
		"2026",
		"2027",
		"2028",
		"2029",
		"2030",
	]);
	const national = globalSection(page);
	await expect(national.getByTestId("holiday-row")).toHaveCount(12);
	await expect(national.locator("button, input, select")).toHaveCount(0);
	await expect(page.getByTestId("holiday-delete")).toHaveCount(0);
	await expect(national.getByTestId("holidays-global-note")).toContainText(
		"Lịch này có sẵn cho các năm 2024 đến 2028",
	);
	const tetDay1 = national.locator(
		'[data-testid="holiday-row"][data-date="2026-02-17"]',
	);
	await expect(tetDay1.getByTestId("holiday-name")).toHaveText("Mùng 1 Tết");
	await expect(tetDay1.getByTestId("holiday-kind")).toHaveText("Tết");
	await expect(tetDay1.getByTestId("holiday-date")).toHaveText(
		"Thứ Ba, 17/02/2026",
	);
	await expect(
		national
			.locator('[data-testid="holiday-row"][data-date="2026-09-02"]')
			.getByTestId("holiday-kind"),
	).toHaveText("Ngày lễ");
	await expect(
		customSection(page).getByTestId("holidays-custom-empty"),
	).toHaveText("Chưa có ngày nghỉ riêng nào trong năm 2026.");
	await year.selectOption("2029");
	await expect(national.getByTestId("holidays-global-empty")).toContainText(
		"Chưa có lịch ngày lễ quốc gia cho năm 2029",
	);
	await year.selectOption("2024");
	await expect(
		national
			.locator('[data-testid="holiday-row"][data-date="2024-02-10"]')
			.getByTestId("holiday-name"),
	).toHaveText("Mùng 1 Tết");
	expectNoConsoleErrors(page);
});

test("a day off added on Ngày lễ leaves Ngày's same-weekday baseline on the next view, and deleting it brings the week back", async ({
	page,
}) => {
	await page.goto("/");
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
	await markThisDocument(page);
	await openDayThroughTheApp(page);
	await expect(netRevenueChips(page)).toContainText([FULL_BASELINE]);
	await openHolidaysThroughTheApp(page);
	await addDayOff(page, SAMPLE_TUESDAY, ` ${DAY_OFF} `);
	await expect(customSection(page).getByTestId("holidays-status")).toHaveText(
		`Đã thêm ${DAY_OFF}, Thứ Ba, 27/10/2026.`,
	);
	const added = customSection(page).locator(
		`[data-testid="holiday-row"][data-date="${SAMPLE_TUESDAY}"]`,
	);
	await expect(added.getByTestId("holiday-name")).toHaveText(DAY_OFF);
	await expect(added.getByTestId("settings-audit-line")).toContainText(
		"Bạn sửa lần cuối 04/11/2026",
	);
	await expect(page.getByTestId("holiday-delete")).toHaveCount(1);
	await addDayOff(page, SAMPLE_TUESDAY, DAY_OFF);
	await expect(page.getByTestId("holidays-add")).toContainText(
		"Ngày này đã có ngày nghỉ riêng cùng tên.",
	);
	await expect(page.getByTestId("holiday-delete")).toHaveCount(1);
	await openDayThroughTheApp(page);
	await expect(netRevenueChips(page)).toContainText([
		BASELINE_WITHOUT_ONE_WEEK,
	]);
	await expect(netRevenueChips(page)).not.toContainText([FULL_BASELINE]);
	await openHolidaysThroughTheApp(page);
	await customSection(page)
		.getByRole("button", { name: `Xóa ${DAY_OFF}, Thứ Ba, 27/10/2026` })
		.click();
	await expect(customSection(page).getByTestId("holidays-status")).toHaveText(
		`Đã xóa ${DAY_OFF}, Thứ Ba, 27/10/2026.`,
	);
	await expect(
		customSection(page).getByTestId("holidays-custom-empty"),
	).toBeVisible();
	await expect(
		customSection(page).getByTestId("holidays-custom-title"),
	).toBeFocused();
	await openDayThroughTheApp(page);
	await expect(netRevenueChips(page)).toContainText([FULL_BASELINE]);
	await expectSameDocument(page);
	expectNoConsoleErrors(page);
});

test("Ngày lễ passes axe at 360 and 1280 px in both colour schemes and reads in English without raw keys", async ({
	page,
}) => {
	await openSettings(page, "ngay-le");
	await expect(globalSection(page)).toBeVisible();
	await addDayOff(page, "2026-12-24", DAY_OFF);
	await expect(page.getByTestId("holiday-delete")).toHaveCount(1);
	await checkPage(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Holidays");
	await expect(globalSection(page)).toContainText("National holidays");
	await expect(
		globalSection(page)
			.locator('[data-testid="holiday-row"][data-date="2026-02-17"]')
			.getByTestId("holiday-name"),
	).toHaveText("Tết, day 1");
	await expect(customSection(page)).toContainText("Your own days off");
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
