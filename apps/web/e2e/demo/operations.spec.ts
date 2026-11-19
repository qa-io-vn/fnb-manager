import { expect, type Page, test } from "@playwright/test";
import { checkPage } from "../support/checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import { openTheme } from "../support/themes";

const RAW_KEY =
	/\b(settings|operations|report|theme|metric)\.[a-z]+[A-Za-z_]*\./;
const PLAIN =
	"Mục này cần ứng dụng nhân viên; bản demo không có nên chưa có số liệu.";

const PAGES = [
	{ slug: "checklist", tab: "Checklist" },
	{ slug: "ket-tien", tab: "Két tiền" },
	{ slug: "su-co", tab: "Sự cố & bàn giao" },
] as const;

async function expectPlainOperationsPage(
	page: Page,
	tab: string,
): Promise<void> {
	await expect(
		page.getByRole("heading", { level: 1, name: `Vận hành · ${tab}` }),
	).toBeVisible();
	await expect(
		page.getByTestId("operations-tabs").locator('[aria-current="page"]'),
	).toHaveText(tab);
	await expect(page.getByTestId("operations-demo")).toHaveText(
		"Bản demo không có ứng dụng nhân viên nên chưa có checklist, số đếm két hay sự cố. Khi cửa hàng dùng ứng dụng nhân viên trên Zalo, trang này cho thấy chúng theo cửa hàng, ngày và ca.",
	);
	await expect(page.getByTestId("report-cards")).toHaveCount(0);
	await expect(page.getByTestId("range-picker")).toHaveCount(0);
	await expect(page.locator("main button")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	watchConsoleErrors(page);
});

test("the three operations pages show the demo's plain state, linked to each other, with no form or figure", async ({
	page,
}) => {
	await page.goto("/#/van-hanh");
	await expect(page).toHaveURL(/#\/van-hanh\/checklist\?range=7d$/);
	await expectPlainOperationsPage(page, "Checklist");
	await checkPage(page);
	for (const target of PAGES.slice(1)) {
		await page
			.getByTestId("operations-tabs")
			.getByRole("link", { name: target.tab })
			.click();
		await expect(page).toHaveURL(new RegExp(`#/van-hanh/${target.slug}\\?`));
		await expectPlainOperationsPage(page, target.tab);
		await checkPage(page);
	}
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Operations · Incidents & handovers",
		}),
	).toBeVisible();
	await expect(page.getByTestId("operations-demo")).toContainText(
		"The demo has no staff app",
	);
	const text = (await page.locator("main").textContent()) ?? "";
	expect(RAW_KEY.test(text)).toBe(false);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	await page.goto("/#/van-hanh/khong-co");
	await expect(page).toHaveURL(/#\/van-hanh\/checklist/);
	expectNoConsoleErrors(page);
});

test("Ca & két tiền shows the app's count card in its plain state for a missing input", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	const card = page.getByTestId("operations-card-cash-counts");
	await expect(card).toHaveAttribute("data-state", "plain");
	await expect(card.getByRole("heading")).toHaveText(
		"Số đếm két trên ứng dụng",
	);
	await expect(card.getByTestId("card-plain")).toHaveText(PLAIN);
	await expect(card.locator("table")).toHaveCount(0);
	await checkPage(page);
	expectNoConsoleErrors(page);
});

test("Chất lượng dữ liệu shows the uncounted shifts and missed checklists cards in their plain state", async ({
	page,
}) => {
	await openTheme(page, "quality");
	for (const [id, title] of [
		["operations-card-missing-counts", "Ca đã đóng chưa đếm két"],
		["operations-card-missing-checklists", "Checklist bị bỏ"],
	] as const) {
		const card = page.getByTestId(id);
		await expect(card).toHaveAttribute("data-state", "plain");
		await expect(card.getByRole("heading")).toHaveText(title);
		await expect(card.getByTestId("card-plain")).toHaveText(PLAIN);
	}
	await checkPage(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await expect(
		page.getByTestId("operations-card-missing-checklists").getByRole("heading"),
	).toHaveText("Missed checklists");
	await expect(
		page
			.getByTestId("operations-card-missing-counts")
			.getByTestId("card-plain"),
	).toHaveText(
		"This section needs the staff app; the demo has none, so it has no figures yet.",
	);
	await page.getByRole("button", { name: "VI", exact: true }).click();
	expectNoConsoleErrors(page);
});
