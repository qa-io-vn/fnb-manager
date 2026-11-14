import { expect, test } from "@playwright/test";
import { checkPage, waitForCharts } from "../support/checks";
import { expectNoExternalRequests, REPORT_CLOCK } from "../support/reports";
import {
	choosePreset,
	expectCsvTablesWithBom,
	expectEveryThemeCardSettled,
	expectThemeInEnglish,
	expectThemePrintLayout,
	openTheme,
	themeCard,
	themeCardIds,
	themeCards,
	themeSearch,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test("Doanh thu opens on the last four weeks with every card settled", async ({
	page,
}) => {
	await openTheme(page, "revenue");
	await expect(
		page.getByRole("heading", { level: 1, name: "Doanh thu & xu hướng" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(
		page.getByTestId("range-presets").getByRole("radio", { name: "4 tuần" }),
	).toBeChecked();
	await expect(page.getByTestId("range-label")).toContainText(
		"28 ngày · so với 4 tuần trước",
	);
	await expect(themeCards(page, "revenue")).toHaveCount(
		themeCardIds.revenue.length,
	);
	await expectEveryThemeCardSettled(page, "revenue");
	const net = themeCard(page, "revenue", "net_revenue");
	await expect(net.getByTestId("comparison-chip")).toHaveCount(2);
	await expect(net.getByTestId("comparison-chip").first()).toContainText(
		"so với 4 tuần trước",
	);
});

test("a longer preset adds the months card and a short one drops it", async ({
	page,
}) => {
	await openTheme(page, "revenue");
	await expect(themeCard(page, "revenue", "by_month")).toHaveCount(0);
	await choosePreset(page, "13 tuần");
	expect(themeSearch(page).get("range")).toBe("91d");
	await expect(themeCard(page, "revenue", "by_month")).toBeVisible();
	await expectEveryThemeCardSettled(page, "revenue");
	await choosePreset(page, "7 ngày");
	await expect(themeCard(page, "revenue", "by_month")).toHaveCount(0);
	await expect(
		themeCard(page, "revenue", "net_revenue")
			.getByTestId("comparison-chip")
			.first(),
	).toContainText("so với 7 ngày trước");
});

test("a custom range survives a reload and steps by its own length", async ({
	page,
}) => {
	await openTheme(page, "revenue", "from=2026-10-08&to=2026-10-21");
	expect(themeSearch(page).get("from")).toBe("2026-10-08");
	await expect(page.getByTestId("range-label")).toContainText("14 ngày");
	await page.reload();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("to")).toBe("2026-10-21");
	await page.getByRole("button", { name: "Khoảng trước" }).click();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-09-24");
	expect(themeSearch(page).get("to")).toBe("2026-10-07");
	await page.goBack();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-10-08");
});

test("the young store has no last year and a single store shows period rows", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "revenue");
	const net = themeCard(page, "revenue", "net_revenue");
	await expect(net.getByTestId("comparison-chip").nth(1)).toContainText(
		"chưa có dữ liệu năm trước",
	);
	await expect(themeCard(page, "revenue", "store_share")).toHaveCount(0);
	await expect(net.locator("tbody tr")).toHaveCount(3);
});

test("every Doanh thu table downloads as UTF-8 CSV with a BOM and Vietnamese headers", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=91d");
	const headers: string[] = [];
	for (const id of [...themeCardIds.revenue, "by_month"]) {
		headers.push(
			...(await expectCsvTablesWithBom(page, themeCard(page, "revenue", id))),
		);
	}
	expect(headers.join(" ")).toContain("Doanh thu thuần");
	expect(headers.join(" ")).toContain("Trung bình trượt");
});

test("Doanh thu prints without controls, passes axe and fits 360 px", async ({
	page,
}) => {
	await openTheme(page, "revenue");
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await openTheme(page, "revenue", "range=this_year&store=MOCK-S1");
	await waitForCharts(page);
	await checkPage(page);
});

test("Doanh thu makes no request outside its origin and reads well in English", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("revenue"));
		await waitForSettledThemeCards(page);
		await choosePreset(page, "Tháng trước");
	});
	await expectThemeInEnglish(page, "Revenue and trend");
});

test("the theme tabs keep the range when moving to Giờ & ngày", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=91d");
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Giờ & ngày trong tuần" })
		.click();
	await waitForSettledThemeCards(page);
	expect(new URL(page.url()).hash).toContain("/chu-de/gio-ngay");
	expect(themeSearch(page).get("range")).toBe("91d");
});
