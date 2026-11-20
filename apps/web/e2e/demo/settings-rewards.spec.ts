import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import { expectCurrentSettingsPage, openSettings } from "../support/settings";

const RAW_KEY = /\b(settings|theme|loyalty)\.[a-z]+[A-Za-z_]*\./;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the Ưu đãi tab of Khách hàng thân thiết shows the demo's sample catalogue read only, with each store's rail and why a reward cannot be activated", async ({
	page,
}) => {
	await openSettings(page, "khach-hang-than-thiet");
	await expectCurrentSettingsPage(page, "Khách hàng thân thiết");
	const tabs = page.getByTestId("loyalty-tabs");
	await expect(tabs.getByRole("link")).toHaveText(["Chương trình", "Ưu đãi"]);
	await expect(
		tabs.getByRole("link", { name: "Chương trình" }),
	).toHaveAttribute("aria-current", "page");
	await tabs.getByRole("link", { name: "Ưu đãi" }).click();
	await expect(page).toHaveURL(
		/#\/cai-dat\/khach-hang-than-thiet\?tab=uu-dai$/,
	);
	await expect(page.getByTestId("rewards-demo")).toContainText(
		"Bản demo cho xem một danh mục ưu đãi mẫu, chỉ để đọc.",
	);
	const rows = page.getByTestId("reward-row");
	await expect(rows).toHaveCount(3);
	await expect(rows.getByTestId("reward-status")).toHaveText([
		"Đang áp dụng",
		"Đã duyệt",
		"Bản nháp",
	]);
	await expect(page.getByTestId("reward-approval")).toHaveText(
		/^Chủ quán đã duyệt lúc/,
	);
	await expect(page.getByTestId("reward-owner-approves")).toContainText(
		"Chỉ chủ quán quản lý mọi cửa hàng mới duyệt được ưu đãi.",
	);
	await expect(page.getByTestId("reward-actions")).toHaveCount(0);
	await expect(page.getByTestId("reward-create")).toHaveCount(0);
	await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
	const form = page.getByTestId("reward-form");
	await expect(form.getByLabel("Tên ưu đãi", { exact: true })).toHaveValue(
		"Tặng 1 ly trà sữa truyền thống",
	);
	await expect(
		form.getByLabel("Loại phần thưởng", { exact: true }),
	).toHaveValue("Tặng món");
	for (const control of await page.locator("main input, main textarea").all()) {
		await expect(control).toHaveAttribute("readonly", "");
	}
	await expect(page.locator("main select")).toHaveCount(0);
	await expect(page.getByTestId("reward-rails-summary")).toHaveText(
		"Mọi cửa hàng áp dụng đã sẵn sàng.",
	);
	await rows.nth(1).click();
	await expect(page.getByTestId("reward-form-title")).toHaveText(
		"Điều kiện của Giảm 20% hóa đơn",
	);
	await expect(form.getByLabel("Mức giảm", { exact: true })).toHaveValue("20");
	await expect(form).toContainText(
		"Tối đa 50% giá được giảm (Thông tư 39/2025/TT-BCT, Điều 4).",
	);
	await expect(page.getByTestId("reward-activation-blocked")).toContainText(
		"Chưa kích hoạt được:",
	);
	await expect(
		page
			.getByTestId("reward-rail-store")
			.filter({ hasText: "Chưa có kênh ưu đãi" }),
	).toHaveCount(1);
	await expect(page.getByTestId("reward-days-demo")).toBeVisible();
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Loyalty programme");
	await expect(page.getByTestId("rewards-demo")).toContainText(
		"The demo shows a sample reward catalogue, read only.",
	);
	await expect(page.getByTestId("loyalty-tabs").getByRole("link")).toHaveText([
		"Programme",
		"Rewards",
	]);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	expectNoConsoleErrors(page);
});
