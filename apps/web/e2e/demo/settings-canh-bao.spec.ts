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

test("Cảnh báo shows the dispatcher, every destination state, the rules, the policies and the history, accessible at 360 and 1280 px", async ({
	page,
}) => {
	await openSettings(page, "canh-bao");
	await expectCurrentSettingsPage(page, "Cảnh báo");
	await expect(page.getByTestId("notify-demo")).toBeVisible();
	await expect(page.getByTestId("notify-schedule")).toHaveAttribute(
		"data-enabled",
		"true",
	);
	await expect(page.getByTestId("notify-quota")).toContainText("412 / 3000");
	const destinations = page.getByTestId("notify-destination");
	await expect(destinations).toHaveCount(3);
	await expect(
		page.locator('[data-testid="notify-destination"][data-status="active"]'),
	).toHaveCount(1);
	await expect(
		page.locator('[data-testid="notify-destination"][data-status="pending"]'),
	).toHaveCount(1);
	await expect(
		page
			.locator('[data-testid="notify-destination"][data-status="failing"]')
			.getByTestId("notify-destination-error"),
	).toContainText("token không hợp lệ");
	await expect(page.getByTestId("notify-rule").first()).toBeVisible();
	await expect(
		page.locator(
			'[data-testid="notify-rule"][data-rule="revenue_below_baseline"]',
		),
	).toHaveAttribute("data-source", "tenant");
	await expect(page.getByTestId("notify-policy").first()).toBeVisible();
	await expect(page.getByTestId("notify-policies-other")).toContainText("[QC]");
	await expect(page.getByTestId("notify-episode")).toHaveCount(3);
	for (const status of ["sent", "held", "uncertain", "failed", "cancelled"]) {
		await expect(
			page.locator(`[data-testid="notify-message"][data-status="${status}"]`),
		).toHaveCount(1);
	}
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByTestId("notify-destinations").getByRole("heading"),
	).toHaveText("Destinations");
	await expect(page.locator("body")).not.toContainText("settings.notify.");
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});

test("the test button reports a sent message for the active destination and the reason for the failing one", async ({
	page,
}) => {
	await openSettings(page, "canh-bao");
	const active = page.locator(
		'[data-testid="notify-destination"][data-status="active"]',
	);
	await active.getByTestId("notify-test").click();
	await expect(active.getByTestId("notify-test-outcome")).toContainText(
		"Tin thử đã gửi",
	);
	await expect(active.getByTestId("notify-test")).toBeEnabled();
	await active.getByTestId("notify-test").click();
	await expect(active.getByTestId("notify-test-error")).toContainText(
		"thao tác quá nhanh",
	);
	const failing = page.locator(
		'[data-testid="notify-destination"][data-status="failing"]',
	);
	await failing.getByTestId("notify-test").click();
	await expect(failing.getByTestId("notify-test-outcome")).toContainText(
		"token không hợp lệ",
	);
	expectNoConsoleErrors(page);
});

test("a member links a Zalo Bot that turns active after the simulated acceptance, links an e-mail, edits, removes and stops all", async ({
	page,
}) => {
	await openSettings(page, "canh-bao");
	await page.getByTestId("notify-link-email").click();
	await expect(page.getByTestId("notify-link-notice")).toContainText(
		"không phải quảng cáo",
	);
	await page.getByTestId("notify-link-start").click();
	await expect(page.getByTestId("notify-link-done")).toContainText("e-mail");
	await expect(
		page.locator('[data-testid="notify-destination"][data-kind="email"]'),
	).toHaveAttribute("data-status", "active");
	const removable = page.locator(
		'[data-testid="notify-destination"][data-status="active"][data-kind="zalo_bot"]',
	);
	await removable.getByTestId("notify-remove").click();
	await expect(removable.getByTestId("notify-remove-confirm")).toContainText(
		"sự đồng ý vẫn giữ nguyên",
	);
	await removable.getByTestId("notify-remove-yes").click();
	await expect(page.getByTestId("notify-removed")).toContainText("Đã gỡ");
	await page.getByTestId("notify-link-bot").click();
	await page.getByTestId("notify-link-start").click();
	const code = page.getByTestId("notify-link-code");
	await expect(code).toContainText(/FNB-DEMO\d{4}/);
	await expect(code).toContainText("ĐỒNG Ý");
	await expect(page.getByTestId("notify-link-done")).toContainText(
		"Đã kết nối",
		{ timeout: 20_000 },
	);
	expect(page.url()).not.toContain("FNB-");
	const mail = page.locator(
		'[data-testid="notify-destination"][data-kind="email"]',
	);
	await mail.getByTestId("notify-edit-open").click();
	const editor = mail.getByTestId("notify-edit");
	await editor
		.getByLabel("Múi giờ của người nhận", { exact: false })
		.fill("Mars/Base");
	await editor.getByRole("button", { name: "Lưu" }).click();
	await expect(editor).toContainText("Múi giờ phải là tên IANA");
	await editor
		.getByLabel("Múi giờ của người nhận", { exact: false })
		.fill("Asia/Bangkok");
	await editor.getByLabel("Tên hiển thị").fill("E-mail ca sáng");
	await editor.getByRole("button", { name: "Lưu" }).click();
	await expect(mail).toContainText("E-mail ca sáng");
	await page.getByTestId("notify-stop-all").click();
	await expect(page.getByTestId("notify-stop-confirm")).toContainText(
		"Sự đồng ý bị rút lại",
	);
	await page.getByTestId("notify-stop-yes").click();
	await expect(page.getByTestId("notify-stop-done")).toContainText(
		"Đã ngừng nhận",
	);
	await expect(
		page.locator('[data-testid="notify-destination"][data-kind="email"]'),
	).toHaveAttribute("data-status", "disabled");
	expectNoConsoleErrors(page);
});

test("the owner overrides a rule for one store, an invalid threshold saves nothing, Mặc định restores it, and a window is narrowed and restored", async ({
	page,
}) => {
	await openSettings(page, "canh-bao");
	const rules = page.getByTestId("notify-rules");
	await rules.getByTestId("notify-rules-store").selectOption({ index: 1 });
	const rule = rules.locator(
		'[data-testid="notify-rule"][data-rule="revenue_below_baseline"]',
	);
	await expect(rule).toHaveAttribute("data-source", "tenant");
	await rule.getByTestId("notify-rule-edit").click();
	await rule.getByTestId("notify-param-ratio").fill("5");
	await rule.getByTestId("notify-rule-save").click();
	await expect(rule.getByTestId("notify-param-problem")).toContainText("ratio");
	await rule.getByTestId("notify-param-ratio").fill("0,5");
	await rule.getByTestId("notify-rule-enabled").uncheck();
	await rule.getByTestId("notify-rule-save").click();
	await expect(rule).toHaveAttribute("data-source", "store");
	await expect(rule).toHaveAttribute("data-enabled", "false");
	await rule.getByTestId("notify-rule-reset").click();
	await expect(rule).toHaveAttribute("data-source", "tenant");
	const policy = page.locator(
		'[data-testid="notify-policy"][data-kind="zalo_bot"]',
	);
	await policy.getByTestId("notify-policy-edit").click();
	await policy.getByTestId("notify-policy-start").fill("7h");
	await policy.getByTestId("notify-policy-save").click();
	await expect(policy).toContainText("HH:MM");
	await policy.getByTestId("notify-policy-start").fill("08:00");
	await policy.getByTestId("notify-policy-end").fill("21:00");
	await policy.getByTestId("notify-policy-save").click();
	await expect(policy).toHaveAttribute("data-source", "tenant");
	await expect(policy).toContainText("08:00");
	await policy.getByTestId("notify-policy-reset").click();
	await expect(policy).toHaveAttribute("data-source", "global");
	expectNoConsoleErrors(page);
});

test("the owner resends the uncertain message once; the original stays", async ({
	page,
}) => {
	await openSettings(page, "canh-bao");
	const uncertain = page.locator(
		'[data-testid="notify-message"][data-status="uncertain"]',
	);
	await expect(
		page
			.locator('[data-testid="notify-message"][data-status="sent"]')
			.getByTestId("notify-resend"),
	).toHaveCount(0);
	await uncertain.getByTestId("notify-resend").click();
	await expect(uncertain.getByTestId("notify-resend-confirm")).toContainText(
		"bằng chứng",
	);
	await uncertain.getByTestId("notify-resend-yes").click();
	await expect(page.getByTestId("notify-message")).toHaveCount(6);
	await expect(
		page.locator('[data-testid="notify-message"][data-status="uncertain"]'),
	).toHaveCount(1);
	expectNoConsoleErrors(page);
});
