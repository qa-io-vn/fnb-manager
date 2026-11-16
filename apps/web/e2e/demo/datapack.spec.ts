import { expect, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
	watchConsoleErrors,
} from "../support/reports";

const RAW_EXPORT_KEY = /\bexports\.[a-z]+/;

async function expectTab(page: Page, name: string): Promise<void> {
	await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
}

test("Xuất dữ liệu opens on the pack tab, tells the demo has no invoices to export, stays local and passes axe at 360 and 1280 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto("/#/xuat-du-lieu");
		await expect(
			page.getByRole("heading", { level: 1, name: "Xuất dữ liệu" }),
		).toBeVisible();
		await expectTab(page, "Gói dữ liệu cho AI");
		await expect(page.getByTestId("exports-pack-pending")).toBeVisible();
		await checkPage(page);
		await page
			.getByTestId("exports-tabs")
			.getByRole("link", { name: "Xuất dữ liệu", exact: true })
			.click();
		await expect(page).toHaveURL(/#\/xuat-du-lieu\?tab=xuat$/);
		await expectTab(page, "Xuất dữ liệu");
		await expect(page.getByTestId("exports-demo-notice")).toHaveText(
			/Bản demo không có dữ liệu hóa đơn thật để xuất\./,
		);
		await expect(page.getByTestId("export-form")).toHaveCount(0);
		await checkPage(page);
		await page.getByRole("link", { name: "Xem gói dữ liệu cho AI" }).click();
		await expectTab(page, "Gói dữ liệu cho AI");
	});
	expectNoConsoleErrors(page);
});

test("the export tab reads in English without raw keys and its links reach 44 px", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await page.goto("/#/xuat-du-lieu?tab=xuat");
	await expect(page.getByTestId("exports-demo-notice")).toBeVisible();
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		await expect(
			page.getByRole("heading", { level: 1, name: "Export data" }),
		).toBeVisible();
		await expect(page.getByTestId("exports-demo-notice")).toHaveText(
			/The demo has no real invoices to export\./,
		);
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_EXPORT_KEY.test(text)).toBe(false);
		for (const link of await page
			.getByTestId("exports-tabs")
			.getByRole("link")
			.all()) {
			const box = await link.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}
		await checkPage(page);
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
	expectNoConsoleErrors(page);
});
