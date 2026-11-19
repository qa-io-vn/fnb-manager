import { expect, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	settingsNav,
} from "../support/settings";

const RAW_KEY =
	/\b(settings|operations|report|theme|loyalty)\.[a-z]+[A-Za-z_]*\./;
const FULL_PHONE = /(\+84|\b0)9\d{8}\b/;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Khách hàng thân thiết shows the demo's sample programme read only, after Checklist, in both languages and colour schemes", async ({
	page,
}) => {
	await openSettings(page, "khach-hang-than-thiet");
	await expectCurrentSettingsPage(page, "Khách hàng thân thiết");
	const names = await settingsNav(page).getByRole("link").allTextContents();
	expect(names.indexOf("Khách hàng thân thiết")).toBe(
		names.indexOf("Checklist") + 1,
	);
	await expect(page.getByTestId("loyalty-demo")).toContainText(
		"Bản demo cho xem một chương trình mẫu, chỉ để đọc.",
	);
	const form = page.getByTestId("loyalty-programme-form");
	await expect(
		form.getByLabel("Tên chương trình", { exact: true }),
	).toHaveValue("Tích dấu 8 ly");
	await expect(
		form.getByLabel("Số dấu đầy một thẻ", { exact: true }),
	).toHaveValue("8");
	await expect(form.getByLabel("Trạng thái", { exact: true })).toHaveValue(
		"Bản nháp",
	);
	await expect(page.getByTestId("loyalty-hold")).toHaveAttribute(
		"data-held",
		"true",
	);
	for (const control of await page.locator("main input, main textarea").all()) {
		await expect(control).toHaveAttribute("readonly", "");
	}
	await expect(page.locator("main select")).toHaveCount(0);
	await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-phone-form")).toHaveCount(0);
	await expect(page.getByTestId("loyalty-phone-masked")).toHaveText([
		"+84 ••• ••• 101",
		"+84 ••• ••• 102",
	]);
	await expect(page.getByTestId("loyalty-legal-link")).toHaveAttribute(
		"href",
		"#/cai-dat/phap-ly",
	);
	const main = (await page.locator("main").textContent()) ?? "";
	expect(FULL_PHONE.test(main)).toBe(false);
	expect(FULL_PHONE.test(await page.title())).toBe(false);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Loyalty programme");
	await expect(page.getByTestId("loyalty-demo")).toContainText(
		"The demo shows a sample programme, read only.",
	);
	await expect(page.getByTestId("loyalty-hold")).toContainText(
		"Launch on hold",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page.getByTestId("loyalty-members-link").getByRole("link").click();
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	await expect(page.getByTestId("loyalty-demo")).toBeVisible();
	expectNoConsoleErrors(page);
});
