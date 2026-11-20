import { checkPage, expectNoSeriousAxeViolations } from "../support/checks";
import { clipboardText } from "../support/clipboard";
import { expect, type Locator, type Page, test } from "../support/policy-test";
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

const RAW_KEY = /\b(settings|report|theme)\.[a-z]+[A-Za-z_]*\./;
const NO_RELOAD_MARKER = "nhanVienSameDocument";

function roster(page: Page): Locator {
	return page.getByTestId("staff-roster");
}

function row(page: Page, name: string): Locator {
	return roster(page)
		.getByTestId("staff-row")
		.filter({
			has: page
				.getByTestId("staff-name")
				.filter({ hasText: new RegExp(`^${name}$`) }),
		});
}

function rosterStatus(page: Page): Locator {
	return page.getByTestId("staff-roster-status");
}

async function expectAxeInBothSchemesAt1280(page: Page): Promise<void> {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.emulateMedia({ colorScheme: "dark" });
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
	await checkPage(page);
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Nhân viên lists the demo's sample staff with their role, stores, status, pairing and phone hint, the staff app's plain state and the owner's revenue choice", async ({
	page,
}) => {
	await openSettings(page, "nhan-vien");
	await expectCurrentSettingsPage(page, "Nhân viên");
	await expect(page.getByTestId("settings-demo-note")).toBeVisible();
	await expect(roster(page).getByTestId("staff-name")).toHaveText([
		"Nhân viên 1",
		"Nhân viên 2",
		"Quản lý 1",
		"Nhân viên 3",
	]);
	const paired = row(page, "Nhân viên 1");
	await expect(paired.getByTestId("staff-role")).toHaveText("Nhân viên");
	await expect(paired.getByTestId("staff-stores")).toHaveText("Cửa hàng mẫu 1");
	await expect(paired.getByTestId("staff-status")).toHaveText("Đang hoạt động");
	await expect(paired.getByTestId("staff-pairing")).toHaveText(
		"Đã ghép nối ngày 13/10/2026",
	);
	await expect(paired.getByTestId("staff-phone")).toHaveText("…204");
	await expect(row(page, "Quản lý 1").getByTestId("staff-stores")).toHaveText(
		"Cửa hàng mẫu 1, Cửa hàng mẫu 2",
	);
	await expect(row(page, "Nhân viên 3").getByTestId("staff-status")).toHaveText(
		"Đã ngừng từ 25/10/2026",
	);
	await expect(page.getByTestId("staff-pair")).toHaveCount(3);
	await expect(
		row(page, "Nhân viên 3").getByRole("button", {
			name: "Tạo mã ghép nối cho Nhân viên 3",
		}),
	).toHaveCount(0);
	await expect(page.getByTestId("staff-app-empty")).toBeVisible();
	await expect(page.getByTestId("staff-app-qr")).toHaveCount(0);
	const revenue = page.getByTestId("staff-revenue");
	await expect(
		revenue.getByLabel("Toàn bộ doanh thu của cửa hàng mình"),
	).toBeChecked();
	await expect(revenue.getByTestId("staff-revenue-option")).toHaveCount(3);
	await expectAxeInBothSchemesAt1280(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expectCurrentSettingsPage(page, "Staff");
	await expect(paired.getByTestId("staff-status")).toHaveText("Active");
	await expect(paired.getByTestId("staff-pairing")).toHaveText(
		"Paired on 13/10/2026",
	);
	await expect(revenue.getByLabel("All revenue of their stores")).toBeChecked();
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	expectNoConsoleErrors(page);
});

test("an owner adds, edits, deactivates and reactivates a person and changes the revenue staff see, for the session, without a reload", async ({
	page,
}) => {
	await openSettings(page, "cua-hang");
	await page.evaluate(
		(marker) => Reflect.set(window, marker, true),
		NO_RELOAD_MARKER,
	);
	await settingsNav(page).getByRole("link", { name: "Nhân viên" }).click();
	await expectCurrentSettingsPage(page, "Nhân viên");
	await expect(roster(page).getByTestId("staff-row")).toHaveCount(4);

	await page.getByRole("button", { name: "Thêm nhân viên" }).click();
	const form = page.getByTestId("staff-form");
	await form.getByRole("button", { name: "Thêm" }).click();
	await expect(form.getByText("Ô này không được để trống.")).toBeVisible();
	await expect(form.getByText("Chọn ít nhất một cửa hàng.")).toBeVisible();
	await form.getByLabel("Tên hiển thị").fill("Nhân viên 5");
	await form.getByLabel("Cửa hàng mẫu 2").check();
	await page.setViewportSize({ width: 360, height: 800 });
	await expectNoSeriousAxeViolations(page);
	await page.setViewportSize({ width: 1280, height: 800 });
	await form.getByRole("button", { name: "Thêm" }).click();
	await expect(rosterStatus(page)).toHaveText("Đã thêm Nhân viên 5.");
	const added = row(page, "Nhân viên 5");
	await expect(added.getByTestId("staff-status")).toHaveText("Chờ ghép nối");
	await expect(added.getByTestId("staff-stores")).toHaveText("Cửa hàng mẫu 2");
	await expect(added.getByTestId("settings-audit-line")).toContainText(
		"Bạn sửa lần cuối",
	);

	await added.getByRole("button", { name: "Sửa Nhân viên 5" }).click();
	const edit = added.getByTestId("staff-form");
	await edit.getByLabel("Vai trò").selectOption("manager");
	await edit.getByLabel("Tất cả cửa hàng, cả cửa hàng mở sau này").check();
	await edit.getByRole("button", { name: "Lưu" }).click();
	await expect(rosterStatus(page)).toHaveText(
		"Đã lưu thay đổi của Nhân viên 5.",
	);
	await expect(added.getByTestId("staff-role")).toHaveText("Quản lý");
	await expect(added.getByTestId("staff-stores")).toHaveText("Tất cả cửa hàng");

	await added
		.getByRole("button", { name: "Ngừng quyền của Nhân viên 5" })
		.click();
	await expect(added.getByTestId("staff-confirm")).toContainText(
		"Ngừng quyền của Nhân viên 5?",
	);
	await expectNoSeriousAxeViolations(page);
	await added.getByRole("button", { name: "Ngừng quyền", exact: true }).click();
	await expect(rosterStatus(page)).toHaveText(
		"Đã ngừng quyền của Nhân viên 5.",
	);
	await expect(added).toHaveAttribute("data-status", "inactive");
	await expect(roster(page).getByTestId("staff-name")).toHaveText([
		"Nhân viên 1",
		"Nhân viên 2",
		"Quản lý 1",
		"Nhân viên 3",
		"Nhân viên 5",
	]);
	await added
		.getByRole("button", { name: "Mở lại quyền của Nhân viên 5" })
		.click();
	await expect(rosterStatus(page)).toHaveText(
		"Đã mở lại Nhân viên 5; người này cần ghép nối lại.",
	);
	await expect(added).toHaveAttribute("data-status", "invited");

	const revenue = page.getByTestId("staff-revenue");
	await revenue.getByLabel("Chỉ tổng hôm nay").check();
	await revenue.getByRole("button", { name: "Lưu" }).click();
	await expect(revenue.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await expect(revenue).toHaveAttribute("data-saved", "store_totals");

	await settingsNav(page).getByRole("link", { name: "Cửa hàng" }).click();
	await expectCurrentSettingsPage(page, "Cửa hàng");
	await settingsNav(page).getByRole("link", { name: "Nhân viên" }).click();
	await expect(row(page, "Nhân viên 5")).toHaveAttribute(
		"data-status",
		"invited",
	);
	await expect(page.getByTestId("staff-revenue")).toHaveAttribute(
		"data-saved",
		"store_totals",
	);
	expect(
		await page.evaluate(
			(marker) => Reflect.get(window, marker),
			NO_RELOAD_MARKER,
		),
	).toBe(true);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("an owner issues a pairing code that shows once, large, with its ten-minute countdown and a copy button, expires on time and is kept in no storage, address or console line", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	const messages: string[] = [];
	page.on("console", (message) => messages.push(message.text()));
	await openSettings(page, "nhan-vien");
	const target = row(page, "Nhân viên 2");
	await target
		.getByRole("button", { name: "Tạo mã ghép nối cho Nhân viên 2" })
		.click();
	const panel = target.getByTestId("pairing-code");
	await expect(panel).toContainText("Mã ghép nối cho Nhân viên 2");
	const value = panel.getByTestId("pairing-code-value");
	await expect(value).toHaveText(/^[0-9]{6}$/);
	const code = (await value.textContent()) ?? "";
	const size = await value.evaluate((element) =>
		Number.parseFloat(getComputedStyle(element).fontSize),
	);
	expect(size).toBeGreaterThanOrEqual(36);
	await expect(panel.getByRole("timer")).toHaveText("Còn hiệu lực 10:00");
	const copy = panel.getByRole("button", { name: "Chép mã" });
	await expect(copy).toBeFocused();
	await copy.click();
	await expect(panel.getByTestId("pairing-code-copy-status")).toHaveText(
		"Đã chép mã.",
	);
	expect(await clipboardText(page)).toBe(code);
	await checkPage(page);
	await page.emulateMedia({ colorScheme: "dark" });
	await page.setViewportSize({ width: 1280, height: 800 });
	await expectNoSeriousAxeViolations(page);
	await page.emulateMedia({ colorScheme: "light" });
	const kept = await page.evaluate(() =>
		JSON.stringify([
			Object.entries(window.localStorage),
			Object.entries(window.sessionStorage),
			document.cookie,
			window.location.href,
			window.history.state,
		]),
	);
	expect(kept).not.toContain(code);
	expect(page.url()).not.toContain(code);
	expect(messages.filter((message) => message.includes(code))).toEqual([]);

	await page.clock.setFixedTime(new Date(REPORT_CLOCK.getTime() + 61_000));
	await expect(panel.getByRole("timer")).toHaveText("Còn hiệu lực 08:59");
	await page.clock.setFixedTime(
		new Date(REPORT_CLOCK.getTime() + 10 * 60_000 + 1000),
	);
	await expect(panel.getByTestId("pairing-code-expired")).toHaveText(
		"Mã đã hết hạn. Tạo mã mới nếu người này chưa ghép nối.",
	);
	await expect(panel.getByTestId("pairing-code-value")).toHaveCount(0);
	await expect(panel.getByRole("button", { name: "Chép mã" })).toHaveCount(0);
	await expect(page.locator("main")).not.toContainText(code);
	await panel.getByRole("button", { name: "Đóng" }).click();
	await expect(target.getByTestId("pairing-code")).toHaveCount(0);

	await target
		.getByRole("button", { name: "Tạo mã ghép nối cho Nhân viên 2" })
		.click();
	await expect(target.getByTestId("pairing-code-value")).toHaveText(
		/^[0-9]{6}$/,
	);
	await target
		.getByRole("button", { name: "Ngừng quyền của Nhân viên 2" })
		.click();
	await target
		.getByRole("button", { name: "Ngừng quyền", exact: true })
		.click();
	await expect(target).toHaveAttribute("data-status", "inactive");
	await expect(target.getByTestId("pairing-code")).toHaveCount(0);
	await expect(
		target.getByRole("button", { name: "Tạo mã ghép nối cho Nhân viên 2" }),
	).toHaveCount(0);
	expectNoConsoleErrors(page);
});
