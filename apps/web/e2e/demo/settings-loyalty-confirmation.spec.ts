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

// Use case (ISTQB): the owner reads how each store confirms loyalty, tries to
// switch a store to staff mode in the demo (read only, like every loyalty
// setting of the demo) and follows the link to the per-staff anomaly report.
test("the Xác nhận tại quầy tab explains both ways, shows each demo store's mode read only and leads to the per-staff anomaly report", async ({
	page,
}) => {
	await openSettings(page, "khach-hang-than-thiet");
	await expectCurrentSettingsPage(page, "Khách hàng thân thiết");
	const tabs = page.getByTestId("loyalty-tabs");
	await tabs.getByRole("link", { name: "Xác nhận tại quầy" }).click();
	await expect(page).toHaveURL(
		/#\/cai-dat\/khach-hang-than-thiet\?tab=xac-nhan$/,
	);
	await expect(
		tabs.getByRole("link", { name: "Xác nhận tại quầy" }),
	).toHaveAttribute("aria-current", "page");

	const compare = page.getByTestId("loyalty-confirmation-compare");
	await expect(compare).toHaveCount(2);
	await expect(compare.first()).toContainText("Khớp hóa đơn POS (mặc định)");
	await expect(compare.first()).toContainText("chờ lần đồng bộ tiếp theo");
	await expect(compare.last()).toContainText("dùng được với mọi POS");
	await expect(compare.last()).toContainText(
		"khách tự nhập lại tổng tiền mà không thấy số nhân viên đã nhập",
	);
	await expect(page.getByTestId("loyalty-confirmation-demo")).toContainText(
		"chỉ để đọc",
	);

	const stores = page.getByTestId("loyalty-confirmation-store");
	await expect(stores).toHaveCount(2);
	await expect(
		page.locator(
			'[data-testid="loyalty-confirmation-mode"][data-mode="staff"]',
		),
	).toHaveCount(1);

	// The store that waits for the POS: switching it to staff mode is not
	// possible in the demo, and nothing can be saved.
	const posStore = stores.filter({
		has: page.locator('[data-mode="pos_sync"]'),
	});
	await posStore.click();
	await expect(posStore).toHaveAttribute("aria-pressed", "true");
	const form = page.getByTestId("loyalty-confirmation-form");
	const staffMode = form.getByTestId("loyalty-confirmation-mode-staff");
	await expect(
		form.getByTestId("loyalty-confirmation-mode-pos_sync"),
	).toBeChecked();
	await expect(staffMode).toBeDisabled();
	await expect(staffMode).not.toBeChecked();
	await expect(form.getByTestId("loyalty-confirmation-switch")).toHaveText(
		"Các mức dưới đây chỉ áp dụng khi cửa hàng xác nhận tại quầy; có thể đặt trước khi chuyển.",
	);
	await expect(page.getByTestId("settings-save-bar")).toHaveCount(0);
	for (const control of await form.locator("input[type=text]").all()) {
		await expect(control).toHaveAttribute("readonly", "");
	}

	// The store in staff mode, with its knobs and the advanced group.
	await stores.filter({ has: page.locator('[data-mode="staff"]') }).click();
	await expect(
		form.getByTestId("loyalty-confirmation-mode-staff"),
	).toBeChecked();
	await expect(
		form.getByLabel("Tổng hóa đơn tối đa", { exact: true }),
	).toHaveValue("1.500.000");
	await expect(
		form.getByLabel("Bằng chứng cần có", { exact: true }),
	).toHaveValue("2 · Khách nhập lại tổng và khớp với nhân viên (khuyên dùng)");
	await expect(form).toContainText("Chặn việc nhập khống một hóa đơn rất lớn.");
	const advanced = form.getByTestId("loyalty-confirmation-advanced");
	await advanced.locator("summary").click();
	await expect(
		advanced.getByLabel("Tỷ lệ kiểm tra ngẫu nhiên", { exact: true }),
	).toHaveValue("2");
	await expect(
		advanced.getByTestId("loyalty-confirmation-self-claim"),
	).toBeChecked();
	await checkPage(page);

	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page
			.getByTestId("loyalty-tabs")
			.getByRole("link", { name: "Counter confirmation" }),
	).toHaveAttribute("aria-current", "page");
	await expect(page.getByTestId("loyalty-confirmation-demo")).toContainText(
		"read only",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();

	await page
		.getByRole("link", { name: "Xem bất thường theo nhân viên" })
		.click();
	await expect(page).toHaveURL(/#\/khach-hang\/bat-thuong/);
	const report = page.getByTestId("bill-anomalies");
	await expect(report).toBeVisible();
	await expect(
		report.getByRole("heading", { name: "Xác nhận tại quầy theo nhân viên" }),
	).toBeVisible();
	const rows = report.getByTestId("bill-anomaly-row");
	await expect(rows.first()).toHaveAttribute("data-flagged", "true");
	await expect(
		rows.first().getByTestId("bill-anomaly-flag").first(),
	).toBeVisible();
	await expect(report.getByTestId("bill-anomaly-legend")).toContainText(
		"Khách khiếu nại",
	);
	await expect(report.getByTestId("bill-anomaly-staff")).toContainText([
		"Minh (ca tối)",
	]);
	await checkPage(page);
	const reportText = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(reportText)).toBe(false);
	expect(reportText).not.toMatch(/\d{9,}/);
	expectNoConsoleErrors(page);
});
