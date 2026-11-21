import { checkPage } from "../support/checks";
import { expect, type Page, test } from "../support/policy-test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";

const RAW_KEY =
	/\b(settings|operations|report|theme|loyalty)\.[a-z]+[A-Za-z_]*\./;
const EXPLANATION =
	"Mục này cần dữ liệu thật: bản demo không có thành viên, sổ điểm hay hàng chờ. Khi cửa hàng chạy chương trình khách hàng thân thiết, trang này cho thấy thành viên, sổ điểm của từng người, các trường hợp cần đối soát và bất thường theo ca.";

const PAGES = [
	{ slug: "thanh-vien", tab: "Thành viên" },
	{ slug: "doi-soat", tab: "Hàng chờ đối soát" },
	{ slug: "bat-thuong", tab: "Bất thường theo ca" },
] as const;

async function expectExplanation(
	page: Page,
	tab: string,
	staffReport = false,
): Promise<void> {
	await expect(
		page.getByRole("heading", { level: 1, name: `Khách hàng · ${tab}` }),
	).toBeVisible();
	await expect(
		page.getByTestId("loyalty-tabs").locator('[aria-current="page"]'),
	).toHaveText(tab);
	await expect(page.getByTestId("loyalty-demo")).toHaveText(EXPLANATION);
	if (staffReport) {
		// The demo has sample counter-confirmation settings, so the per-staff
		// report of a store in staff mode shows; the shift table needs live data.
		await expect(page.getByTestId("loyalty-anomalies")).toHaveCount(0);
		await expect(page.getByTestId("bill-anomalies")).toBeVisible();
		await expect(page.getByTestId("range-picker")).toBeVisible();
		return;
	}
	await expect(page.locator("main table")).toHaveCount(0);
	await expect(page.locator("main input")).toHaveCount(0);
	await expect(page.locator("main button")).toHaveCount(0);
	await expect(page.getByTestId("range-picker")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the customer section explains on each tab that it needs live data, with no list, form or figure", async ({
	page,
}) => {
	await page.goto("/#/khach-hang");
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	await expectExplanation(page, "Thành viên");
	await expect(page.getByTestId("period-picker")).toHaveCount(0);
	await checkPage(page);
	for (const target of PAGES.slice(1)) {
		await page
			.getByTestId("loyalty-tabs")
			.getByRole("link", { name: target.tab })
			.click();
		await expect(page).toHaveURL(
			new RegExp(`#/khach-hang/${target.slug}(\\?.*)?$`),
		);
		await expectExplanation(page, target.tab, target.slug === "bat-thuong");
		await checkPage(page);
	}
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Customers · Shift anomalies",
		}),
	).toBeVisible();
	await expect(page.getByTestId("loyalty-demo")).toContainText(
		"This section needs live data",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page.goto("/#/khach-hang/khong-co");
	await expect(page).toHaveURL(/#\/khach-hang\/thanh-vien$/);
	await page.goto(
		"/#/khach-hang/thanh-vien/aaaaaaaa-0000-4000-8000-000000000001",
	);
	await expect(page.getByTestId("loyalty-demo")).toHaveText(EXPLANATION);
	expectNoConsoleErrors(page);
});
