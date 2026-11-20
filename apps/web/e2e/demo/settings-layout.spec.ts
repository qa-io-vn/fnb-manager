import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import { expectNoConsoleErrors, watchConsoleErrors } from "../support/reports";
import {
	expectCurrentSettingsPage,
	openSettings,
	settingsNav,
} from "../support/settings";

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;

test("Cài đặt opens Cửa hàng with the sub-navigation and the demo note", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/cai-dat");
	await expect(page).toHaveURL(/#\/cai-dat\/cua-hang$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Cài đặt" }),
	).toBeVisible();
	await expectCurrentSettingsPage(page, "Cửa hàng");
	await expect(page.getByTestId("settings-demo-note")).toContainText(
		"chỉ giữ trong phiên này",
	);
	await expect(page.getByTestId("store-page")).toBeVisible();
	await expect(page.getByTestId("settings-placeholder")).toHaveCount(0);
	await expect(page.getByTestId("period-picker")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("the sub-navigation opens each page on a phone and as a side column on a computer", async ({
	page,
}) => {
	await page.setViewportSize({ width: 360, height: 800 });
	await openSettings(page, "cua-hang");
	await settingsNav(page).getByRole("link", { name: "Ngưỡng báo cáo" }).click();
	await expect(page).toHaveURL(/#\/cai-dat\/bao-cao$/);
	await expectCurrentSettingsPage(page, "Ngưỡng báo cáo");
	await expect(page.getByTestId("thresholds-form")).toBeVisible();
	await settingsNav(page).getByRole("link", { name: "Phân loại" }).click();
	await expectCurrentSettingsPage(page, "Phân loại");
	await expect(page.getByTestId("roles-form")).toBeVisible();
	await settingsNav(page).getByRole("link", { name: "Ngày lễ" }).click();
	await expectCurrentSettingsPage(page, "Ngày lễ");
	await expect(page.getByTestId("holidays-page")).toBeVisible();
	await page.setViewportSize({ width: 1280, height: 800 });
	const nav = await settingsNav(page).boundingBox();
	const heading = await page.getByRole("heading", { level: 2 }).boundingBox();
	expect(nav).not.toBeNull();
	expect(heading).not.toBeNull();
	expect((nav?.x ?? 0) + (nav?.width ?? 0)).toBeLessThanOrEqual(
		heading?.x ?? 0,
	);
	await settingsNav(page).getByRole("link", { name: "Pháp lý" }).click();
	await expectCurrentSettingsPage(page, "Pháp lý");
	await expect(page.getByTestId("legal-page")).toBeVisible();
	await expect(page.getByTestId("settings-placeholder")).toHaveCount(0);
	await settingsNav(page).getByRole("link", { name: "Cảnh báo" }).click();
	await expectCurrentSettingsPage(page, "Cảnh báo");
	await expect(page.getByTestId("settings-placeholder")).toContainText("12");
	await expect(page.getByTestId("settings-slot-summary")).toBeVisible();
});

test("the links the reports give to Settings still land on their page", async ({
	page,
}) => {
	await openSettings(page, "phan-loai", "tab=nhom-mon");
	await expectCurrentSettingsPage(page, "Phân loại");
	await openSettings(page, "du-lieu-nhap-tay", "tab=phi");
	await expectCurrentSettingsPage(page, "Dữ liệu nhập tay");
	await page.goto("/#/cai-dat/khong-co");
	await expect(page).toHaveURL(/#\/cai-dat\/cua-hang$/);
});

test("Cài đặt passes axe, fits 360 px and reads in English without raw keys", async ({
	page,
}) => {
	await openSettings(page, "cua-hang");
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Stores");
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await expect(page.getByTestId("tenant-profile")).toContainText("Legal form");
	await page.getByRole("button", { name: "VI", exact: true }).click();
});
