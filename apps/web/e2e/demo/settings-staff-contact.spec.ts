import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import { expectCurrentSettingsPage, openSettings } from "../support/settings";

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the owner changes the staff app's contact note for the session, a link held back before sending", async ({
	page,
}) => {
	await openSettings(page, "nhan-vien");
	await expectCurrentSettingsPage(page, "Nhân viên");
	const section = page.getByTestId("staff-contact");
	const field = section.getByLabel("Lời nhắn", { exact: true });
	await expect(field).toHaveValue(
		"Gặp quản lý ca tại quầy để nhận mã ghép nối. Ngoài giờ làm, nhắn quản lý qua Zalo.",
	);
	await field.fill("Xem www.example.com để biết thêm");
	await expect(section.getByTestId("settings-field-error")).toHaveText(
		"Lời nhắn không được chứa đường link; ghi tên người hoặc số điện thoại thay vào.",
	);
	await expect(section.getByRole("button", { name: "Lưu" })).toHaveAttribute(
		"aria-disabled",
		"true",
	);
	await checkPage(page);
	await field.fill("Gặp chị quản lý ca sáng ở quầy.\nGọi 0901 234 567.");
	await section.getByRole("button", { name: "Lưu" }).click();
	await expect(section.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByTestId("staff-contact").getByRole("heading"),
	).toHaveText("Contact note in the staff app");
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await expect(
		page.getByTestId("staff-contact").getByLabel("Lời nhắn", { exact: true }),
	).toHaveValue("Gặp chị quản lý ca sáng ở quầy.\nGọi 0901 234 567.");
	expectNoConsoleErrors(page);
});
