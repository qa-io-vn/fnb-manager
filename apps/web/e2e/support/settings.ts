import { expect, type Locator, type Page } from "@playwright/test";

export const settingsSlugs = [
	"cua-hang",
	"du-lieu-nhap-tay",
	"phan-loai",
	"ngay-le",
	"bao-cao",
	"phap-ly",
	"nhan-vien",
	"canh-bao",
	"ban-tin",
] as const;

export type SettingsSlug = (typeof settingsSlugs)[number];

export async function openSettings(
	page: Page,
	slug: SettingsSlug,
	search = "",
): Promise<void> {
	await page.goto(`/#/cai-dat/${slug}${search === "" ? "" : `?${search}`}`);
	await expect(page.getByTestId("settings-layout")).toBeVisible();
}

export function settingsNav(page: Page): Locator {
	return page.getByTestId("settings-nav");
}

export async function expectCurrentSettingsPage(
	page: Page,
	name: string,
): Promise<void> {
	await expect(settingsNav(page).locator('[aria-current="page"]')).toHaveText(
		name,
	);
	await expect(
		page.getByRole("heading", { level: 2, name, exact: true }),
	).toBeVisible();
}

export async function saveSettings(scope: Locator): Promise<void> {
	await scope.getByRole("button", { name: /^(Lưu|Save)$/ }).click();
	await expect(scope.getByRole("status")).toContainText(/Đã lưu|Saved/);
}

export async function readField(
	scope: Locator,
	label: string,
): Promise<string> {
	return scope.getByLabel(label, { exact: true }).inputValue();
}
