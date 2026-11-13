import { expect, type Locator, type Page, test } from "@playwright/test";
import { checkPage, parseExactMoney, waitForCharts } from "../support/checks";
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

const MAE_COLUMN = 4;

function card(page: Page, id: string): Locator {
	return page.getByTestId(`card-month-${id}`);
}

async function forecastRows(pace: Locator): Promise<string[][]> {
	const rows = pace
		.getByTestId("table-scroll")
		.first()
		.locator("tbody tr", { hasText: /^Dự báo/ });
	const count = await rows.count();
	const cells: string[][] = [];
	for (let index = 0; index < count; index += 1) {
		cells.push(await rows.nth(index).locator("td").allTextContents());
	}
	return cells;
}

test("all ten Tháng cards settle with a headline and a sentence", async ({
	page,
}) => {
	await openReport(page, "month");
	await expect(
		page.getByRole("heading", { level: 1, name: "Báo cáo tháng" }),
	).toBeVisible();
	expect(currentKey(page, "month")).toBe("2026-11");
	await expect(page.getByTestId("period-label")).toHaveText("Tháng 11/2026");
	await expect(page.getByTestId("period-through")).toHaveText(
		"đến hết ngày 03/11/2026",
	);
	await expect(cards(page, "month")).toHaveCount(cardIds.month.length);
	await expectCardsPresent(page, "month");
	await expectEveryCardSettled(page, "month");
});

test("the two forecasts are listed with the lower MAE first", async ({
	page,
}) => {
	await openReport(page, "month");
	const pace = card(page, "month_pace");
	const rows = await forecastRows(pace);
	expect(rows).toHaveLength(2);
	const [first, second] = rows.map((cells) =>
		parseExactMoney(cells[MAE_COLUMN] ?? null),
	);
	expect(first).toBeGreaterThan(0);
	expect(first).toBeLessThanOrEqual(second ?? 0);
	const forecastChips = pace
		.getByTestId("comparison-chip")
		.filter({ hasText: "dự báo" });
	await expect(forecastChips).toHaveCount(2);
	const leading = (rows[0]?.[0] ?? "").toLowerCase();
	await expect(forecastChips.first()).toContainText(leading);
	await expect(pace.getByTestId("sentence")).toContainText(leading);
});

test("the Pareto chart draws the 80 % line", async ({ page }) => {
	await openReport(page, "month");
	const pareto = card(page, "pareto");
	await pareto.scrollIntoViewIfNeeded();
	await expect(pareto.locator('[data-testid="echarts"] svg')).toBeVisible();
	await expect(
		pareto.locator('[data-testid="echarts"] svg text', { hasText: "ngưỡng" }),
	).toHaveCount(1);
	await expect(pareto.getByTestId("headline")).toHaveText(/^\d+$/);
});

test("the pace chart reaches the forecast lines above the month to date", async ({
	page,
}) => {
	await openReport(page, "month", "month=2026-11&store=MOCK-S1");
	await waitForCharts(page);
	const chart = card(page, "month_pace").getByTestId("echarts");
	await expect(chart).toContainText("dự báo theo đặc trưng ngày trong tuần");
	await expect(chart).toContainText("mục tiêu");
});

test("a month before the young store opened explains every empty card", async ({
	page,
}) => {
	await openReport(page, "month", "month=2026-07&store=MOCK-S2");
	await expectEveryCardSettled(page, "month");
	await expect(card(page, "month_pace").getByTestId("card-notice")).toHaveText(
		"Chưa có số liệu bán hàng trong tháng này.",
	);
});

test("target progress needs a target for every selected store", async ({
	page,
}) => {
	await openReport(page, "month");
	const all = card(page, "target_progress");
	await expect(all.getByTestId("headline")).toHaveText("—");
	const notice = all.getByTestId("card-notice");
	await expect(notice).toContainText("Chưa đặt mục tiêu");
	await expect(notice).toContainText("Cửa hàng mẫu 2");
	await expect(
		notice.getByRole("link", { name: "Đặt mục tiêu tháng" }),
	).toHaveAttribute("href", "#/cai-dat/du-lieu-nhap-tay");
	await openReport(page, "month", "month=2026-11&store=MOCK-S1");
	const single = card(page, "target_progress");
	await expect(single.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(single.getByTestId("card-notice")).toHaveCount(0);
	await expect(single.getByTestId("comparison-chip")).toHaveCount(2);
	await expectEveryCardSettled(page, "month");
});

test("attach rates are measured with the demo roles", async ({ page }) => {
	await openReport(page, "month");
	const attach = card(page, "attach_rate");
	await expect(attach.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(attach.getByTestId("card-notice")).toHaveCount(0);
	await expect(attach.getByTestId("comparison-chip")).toHaveCount(4);
});

test("a deep link to a month survives a reload and stepping returns to it", async ({
	page,
}) => {
	await expectDeepLinkRoundTrip(page, "month", "2026-10");
	await expect(page.getByTestId("period-label")).toHaveText("Tháng 10/2026");
	await expect(page.getByTestId("period-through")).toHaveCount(0);
	await expect(
		card(page, "month_pace").getByTestId("comparison-chip"),
	).toHaveCount(2);
	await openReport(page, "month");
	await expectStepping(page, "month");
	await page.getByTestId("period-date").fill("2026-09-15");
	await expect.poll(() => currentKey(page, "month")).toBe("2026-09");
	await waitForSettledCards(page);
	await page.goBack();
	await expect.poll(() => currentKey(page, "month")).toBe("2026-11");
});

test("the young store's first month cannot tell new items apart", async ({
	page,
}) => {
	await openReport(page, "month", "month=2026-08&store=MOCK-S2");
	const newItems = card(page, "new_items");
	await expect(newItems.getByTestId("headline")).toHaveText("—");
	await expect(newItems.getByTestId("card-notice")).toHaveText(
		"Cửa hàng mới mở: chưa xác định món mới.",
	);
	await expect(
		card(page, "month_pace").getByTestId("comparison-chip").first(),
	).toHaveText("chưa có dữ liệu kỳ trước");
	await expectEveryCardSettled(page, "month");
});

test("tables download as CSV with a BOM and the page prints without controls", async ({
	page,
}) => {
	await openReport(page, "month");
	await expectCsvWithBom(page, "card-month-pareto");
	await expectCsvWithBom(page, "card-month-month_pace");
	await expectPrintLayout(page);
});

test("Tháng passes axe and fits 360 px", async ({ page }) => {
	await openReport(page, "month");
	await waitForCharts(page);
	await checkPage(page);
	await openReport(page, "month", "month=2026-11&store=MOCK-S2");
	await waitForCharts(page);
	await checkPage(page);
});

test("Tháng makes no request outside its origin and reads well in English", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(reportUrl("month"));
		await waitForSettledCards(page);
		await page.getByRole("button", { name: "Kỳ trước" }).click();
		await waitForSettledCards(page);
		await page
			.getByTestId("report-tabs")
			.getByRole("link", { name: "Tháng" })
			.click();
		await waitForSettledCards(page);
	});
	await expectEnglishWithoutKeys(page);
	await expect(card(page, "month_pace").getByTestId("headline")).toBeVisible();
});
