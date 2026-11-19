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

const RAW_KEY = /\b(settings|operations|report|theme)\.[a-z]+[A-Za-z_]*\./;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Checklist shows the demo's plain state and no form, listed after Nhân viên, in both languages and colour schemes", async ({
	page,
}) => {
	await openSettings(page, "checklist");
	await expectCurrentSettingsPage(page, "Checklist");
	const links = settingsNav(page).getByRole("link");
	const names = await links.allTextContents();
	expect(names.indexOf("Checklist")).toBe(names.indexOf("Nhân viên") + 1);
	await expect(page.getByTestId("checklist-demo")).toHaveText(
		"Bản demo không có ứng dụng nhân viên nên không soạn checklist ở đây. Khi cửa hàng dùng ứng dụng nhân viên trên Zalo, trang này soạn checklist mở ca, giữa ca và đóng ca cho từng cửa hàng.",
	);
	await expect(page.getByTestId("checklist-form")).toHaveCount(0);
	await expect(page.getByTestId("checklist-settings")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Tạo checklist" })).toHaveCount(
		0,
	);
	await expect(
		page.locator("main input, main textarea, main select"),
	).toHaveCount(0);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Checklists");
	await expect(page.getByTestId("checklist-demo")).toContainText(
		"The demo has no staff app",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
