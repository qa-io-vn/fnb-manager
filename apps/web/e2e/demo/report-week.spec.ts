import { expect, type Page, test } from "@playwright/test";
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
	waitForSettledCards,
} from "../support/reports";

const UNFILLED_PLACEHOLDER = /\{[A-Za-z]+\}/;

async function expectNoUnfilledPlaceholders(page: Page): Promise<void> {
	const text = (await page.getByTestId("report-cards").textContent()) ?? "";
	expect(UNFILLED_PLACEHOLDER.exec(text)?.[0] ?? null).toBeNull();
}

test("all eight Tuần cards settle with a headline and a sentence", async ({
	page,
}) => {
	await openReport(page, "week");
	await expect(
		page.getByRole("heading", { level: 1, name: "Báo cáo tuần" }),
	).toBeVisible();
	expect(currentKey(page, "week")).toBe("2026-W45");
	await expect(page.getByTestId("period-label")).toHaveText(
		"Tuần 45 · 02/11/2026–08/11/2026",
	);
	await expect(cards(page, "week")).toHaveCount(cardIds.week.length);
	await expectCardsPresent(page, "week");
	await expectEveryCardSettled(page, "week");
	await expectNoUnfilledPlaceholders(page);
	await expect(page.getByTestId("card-week-net_revenue")).toContainText(
		"đến hết 03/11/2026",
	);
});

test("net revenue shows the 4-week average next to last week and last year", async ({
	page,
}) => {
	await openReport(page, "week");
	const chips = page
		.getByTestId("card-week-net_revenue")
		.getByTestId("comparison-chip");
	await expect(chips).toHaveCount(3);
	await expect(chips.nth(0)).toContainText("so với tuần trước");
	await expect(chips.nth(1)).toContainText("so với trung bình 4 tuần");
	await expect(chips.nth(2)).toContainText("so với cùng tuần năm trước");
	await expect(
		page.getByTestId("card-week-movers").getByTestId("headline"),
	).toContainText("%");
});

test("a deep link to a week survives a reload and stepping returns to it", async ({
	page,
}) => {
	await expectDeepLinkRoundTrip(page, "week", "2026-W44");
	await expect(page.getByTestId("period-label")).toHaveText(
		"Tuần 44 · 26/10/2026–01/11/2026",
	);
	await expectEveryCardSettled(page, "week");
	await openReport(page, "week");
	await expectStepping(page, "week");
});

test("stepping back from the first week of 2026 lands in 2025-W52", async ({
	page,
}) => {
	await openReport(page, "week", "week=2026-W01");
	await expect(page.getByTestId("period-label")).toHaveText(
		"Tuần 1 · 29/12/2025–04/01/2026",
	);
	await page.getByRole("button", { name: "Kỳ trước" }).click();
	await expect.poll(() => currentKey(page, "week")).toBe("2025-W52");
	await waitForSettledCards(page);
	await expect(page.getByTestId("period-label")).toHaveText(
		"Tuần 52 · 22/12/2025–28/12/2025",
	);
	await expectEveryCardSettled(page, "week");
	await page.getByRole("button", { name: "Kỳ sau" }).click();
	await expect.poll(() => currentKey(page, "week")).toBe("2026-W01");
	await waitForSettledCards(page);
});

test("the young store has no last year on net revenue", async ({ page }) => {
	await openReport(page, "week", "week=2026-W45&store=MOCK-S2");
	await expect(page.getByTestId("store-select")).toContainText(
		"Cửa hàng mẫu 2",
	);
	const net = page.getByTestId("card-week-net_revenue");
	await expect(net.getByTestId("comparison-chip").last()).toHaveText(
		"chưa có dữ liệu năm trước",
	);
	await expect(net.getByTestId("sentence")).toContainText(
		"chưa có dữ liệu năm trước",
	);
	await expectEveryCardSettled(page, "week");
	await expectNoUnfilledPlaceholders(page);
});

test("tables download as CSV with a BOM and the page prints without controls", async ({
	page,
}) => {
	await openReport(page, "week");
	await expectCsvWithBom(page, "card-week-weekday_curve");
	await expectCsvWithBom(page, "card-week-movers");
	await expectPrintLayout(page);
});

test("Tuần passes axe and fits 360 px", async ({ page }) => {
	await openReport(page, "week");
	await waitForCharts(page);
	await checkPage(page);
	await openReport(page, "week", "week=2026-W45&store=MOCK-S2");
	await waitForCharts(page);
	await checkPage(page);
});

test("Tuần makes no request outside its origin and reads well in English", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(reportUrl("week"));
		await waitForSettledCards(page);
		await page.getByRole("button", { name: "Kỳ trước" }).click();
		await waitForSettledCards(page);
		await page
			.getByTestId("report-tabs")
			.getByRole("link", { name: "Tuần" })
			.click();
		await waitForSettledCards(page);
	});
	await expectEnglishWithoutKeys(page);
	await page.getByRole("button", { name: "EN", exact: true }).click();
	await waitForSettledCards(page);
	await expect(page.getByTestId("report-tabs")).toContainText("Week");
	await expectNoUnfilledPlaceholders(page);
	await page.getByRole("button", { name: "VI", exact: true }).click();
});
