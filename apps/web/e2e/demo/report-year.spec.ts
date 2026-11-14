import { expect, test } from "@playwright/test";
import { checkPage, waitForCharts } from "../support/checks";
import {
	cardIds,
	cards,
	currentKey,
	expectCardsPresent,
	expectCsvWithBom,
	expectDeepLinkRoundTrip,
	expectEnglishWithoutKeys,
	expectEveryCardSettled,
	expectNoExternalRequests,
	expectPrintLayout,
	expectStepping,
	openReport,
	REPORT_CLOCK,
	reportUrl,
	selectStores,
	waitForSettledCards,
} from "../support/reports";

const SINCE_OPENING = "card-year-since_opening";

test("all seven Năm cards settle with a headline and a sentence", async ({
	page,
}) => {
	await openReport(page, "year");
	await expect(
		page.getByRole("heading", { level: 1, name: "Báo cáo năm" }),
	).toBeVisible();
	expect(currentKey(page, "year")).toBe("2026");
	await expect(page.getByTestId("period-label")).toHaveText("Năm 2026");
	await expect(page.getByTestId("period-through")).toHaveText(
		"đến hết ngày 03/11/2026",
	);
	await expect(cards(page, "year")).toHaveCount(cardIds.year.length);
	await expectCardsPresent(page, "year");
	await expectEveryCardSettled(page, "year");
	await expect(page.getByTestId("period-picker")).toHaveCount(0);
});

test("the month × year heat table has a row for 2024, 2025 and 2026", async ({
	page,
}) => {
	await openReport(page, "year");
	const matrix = page.getByTestId("card-year-month_matrix");
	const rows = matrix.locator("tbody tr");
	await expect(rows).toHaveCount(3);
	for (const [index, year] of ["2024", "2025", "2026"].entries()) {
		await expect(rows.nth(index).locator("td").first()).toHaveText(year);
	}
	await expect(matrix.locator("td[data-heat]").first()).toBeVisible();
	await expect(rows.nth(0).locator("td").nth(1)).toHaveText("—");
	await expect(matrix.getByTestId("headline")).toContainText(/\d/);
});

test("since opening follows the young store and hides for the established one", async ({
	page,
}) => {
	await openReport(page, "year");
	await expect(page.getByTestId(SINCE_OPENING)).toBeVisible();
	await expect(
		page.getByTestId(SINCE_OPENING).getByTestId("card-notice"),
	).toContainText("Cửa hàng mẫu 2 chưa có dữ liệu năm trước");
	await selectStores(page, ["MOCK-S1"]);
	await expect.poll(() => new URL(page.url()).hash).toContain("store=MOCK-S1");
	await expect(page.getByTestId(SINCE_OPENING)).toHaveCount(0);
	await expect(cards(page, "year")).toHaveCount(cardIds.year.length - 1);
	await selectStores(page, ["MOCK-S2"]);
	await expect.poll(() => new URL(page.url()).hash).toContain("store=MOCK-S2");
	await expect(page.getByTestId(SINCE_OPENING)).toBeVisible();
	await expectEveryCardSettled(page, "year");
});

test("the young store has no last year on the year-over-year card", async ({
	page,
}) => {
	await openReport(page, "year", "year=2026&store=MOCK-S2");
	await expect(page.getByTestId("store-select")).toContainText(
		"Cửa hàng mẫu 2",
	);
	const yearOverYear = page.getByTestId("card-year-year_over_year");
	await expect(yearOverYear.getByTestId("comparison-chip").first()).toHaveText(
		"chưa có dữ liệu năm trước",
	);
	await expect(yearOverYear.getByTestId("card-notice")).toContainText(
		"chưa có dữ liệu năm trước",
	);
	await expectEveryCardSettled(page, "year");
	await selectStores(page, null);
	await expect.poll(() => new URL(page.url()).hash).not.toContain("store=");
	await expect(
		yearOverYear.getByTestId("comparison-chip").first(),
	).toContainText("cùng cửa hàng (1/2)");
});

test("a deep link to a year survives a reload and stepping returns to it", async ({
	page,
}) => {
	await expectDeepLinkRoundTrip(page, "year", "2025");
	await expect(page.getByTestId("period-label")).toHaveText("Năm 2025");
	await expect(page.getByTestId("period-through")).toHaveCount(0);
	await expect(cards(page, "year")).toHaveCount(cardIds.year.length - 1);
	await expectEveryCardSettled(page, "year");
	await openReport(page, "year");
	await expectStepping(page, "year");
});

test("tables download as CSV with a BOM and the page prints without controls", async ({
	page,
}) => {
	await openReport(page, "year");
	await expectCsvWithBom(page, "card-year-month_matrix");
	await expectCsvWithBom(page, "card-year-item_lifecycle");
	await expectPrintLayout(page);
});

test("Năm passes axe and fits 360 px", async ({ page }) => {
	await openReport(page, "year");
	await waitForCharts(page);
	await checkPage(page);
	await openReport(page, "year", "year=2026&store=MOCK-S2");
	await waitForCharts(page);
	await checkPage(page);
});

test("Năm makes no request outside its origin and reads well in English", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(reportUrl("year"));
		await waitForSettledCards(page);
		await page.getByRole("button", { name: "Kỳ trước" }).click();
		await waitForSettledCards(page);
		await page
			.getByTestId("report-tabs")
			.getByRole("link", { name: "Năm" })
			.click();
		await waitForSettledCards(page);
	});
	await expectEnglishWithoutKeys(page);
});
