import { checkPage } from "../support/checks";
import { expect, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";

const RAW_KEY =
	/\b(settings|operations|report|theme|metric)\.[a-z]+[A-Za-z_]*\./;

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("Thông báo shows the demo's plain state, reached from the other operations pages, with no form, list or link", async ({
	page,
}) => {
	await page.goto("/#/van-hanh/checklist");
	await page
		.getByTestId("operations-tabs")
		.getByRole("link", { name: "Thông báo" })
		.click();
	await expect(page).toHaveURL(/#\/van-hanh\/thong-bao\?range=7d$/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Vận hành · Thông báo" }),
	).toBeVisible();
	await expect(
		page.getByTestId("operations-tabs").locator('[aria-current="page"]'),
	).toHaveText("Thông báo");
	await expect(page.getByTestId("operations-demo")).toHaveText(
		"Bản demo không có ứng dụng nhân viên nên chưa có thông báo. Khi cửa hàng dùng ứng dụng nhân viên trên Zalo, trang này để soạn thông báo, ghim thông báo quan trọng và xem bao nhiêu người đã đọc.",
	);
	for (const absent of [
		"announcement-compose",
		"announcement-list",
		"range-picker",
	]) {
		await expect(page.getByTestId(absent)).toHaveCount(0);
	}
	await expect(page.locator("main button")).toHaveCount(0);
	await expect(page.locator("main form")).toHaveCount(0);
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Operations · Announcements",
		}),
	).toBeVisible();
	await expect(page.getByTestId("operations-demo")).toContainText(
		"The demo has no staff app, so it has no announcements.",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page.goto("/#/van-hanh/thong-bao");
	await expect(page).toHaveURL(/#\/van-hanh\/thong-bao\?range=7d$/);
	await expect(page.getByTestId("operations-page")).toHaveAttribute(
		"data-page",
		"thong-bao",
	);
	expectNoConsoleErrors(page);
});
