import { expect, test } from "@playwright/test";
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
	expectNoConsoleErrors,
	expectNoExternalRequests,
	expectPrintLayout,
	expectShiftsLabelledByNumber,
	expectStepping,
	headlineExact,
	openReport,
	REPORT_CLOCK,
	reportUrl,
	selectStores,
	waitForSettledCards,
} from "../support/reports";

test("all nine Ngày cards settle with a headline and a sentence", async ({
	page,
}) => {
	await openReport(page, "day");
	await expect(
		page.getByRole("heading", { level: 1, name: "Báo cáo ngày" }),
	).toBeVisible();
	expect(currentKey(page, "day")).toBe("2026-11-03");
	await expect(cards(page, "day")).toHaveCount(cardIds.day.length);
	await expectCardsPresent(page, "day");
	await expectEveryCardSettled(page, "day");
	await expect(page.getByTestId("period-label")).toHaveText(
		"Thứ Ba, 03/11/2026",
	);
	await expect(page.getByTestId("period-picker")).toHaveCount(0);
});

test("Hôm nay's yesterday equals Ngày's day for net revenue and invoices", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await page.goto("/");
	const yesterdayNet = await headlineExact(
		page.getByTestId("card-yesterday-net_revenue"),
	);
	const yesterdayInvoices = await headlineExact(
		page.getByTestId("card-yesterday-invoices"),
	);
	expect(parseExactMoney(yesterdayNet)).toBeGreaterThan(0);
	await page
		.getByTestId("side-rail")
		.getByRole("link", { name: "Báo cáo" })
		.click();
	await waitForSettledCards(page);
	expect(currentKey(page, "day")).toBe("2026-11-03");
	expect(await headlineExact(page.getByTestId("card-day-net_revenue"))).toBe(
		yesterdayNet,
	);
	expect(await headlineExact(page.getByTestId("card-day-invoices"))).toBe(
		yesterdayInvoices,
	);
});

test("a deep link to a day survives a reload and stepping returns to it", async ({
	page,
}) => {
	await expectDeepLinkRoundTrip(page, "day", "2026-11-01");
	await expect(page.getByTestId("period-label")).toHaveText(
		"Chủ Nhật, 01/11/2026",
	);
	await openReport(page, "day");
	await expectStepping(page, "day");
	await page.getByTestId("period-date").fill("2026-10-15");
	await expect.poll(() => currentKey(page, "day")).toBe("2026-10-15");
	await waitForSettledCards(page);
	await page.goBack();
	await expect.poll(() => currentKey(page, "day")).toBe("2026-11-03");
});

test("today's date stops at yesterday and links to Hôm nay", async ({
	page,
}) => {
	await openReport(page, "day", "date=2026-11-04");
	await expect(page.getByTestId("report-clamped")).toContainText(
		"Ngày hôm nay chưa kết thúc; báo cáo dừng ở ngày 03/11/2026.",
	);
	await expect(page.getByTestId("period-label")).toHaveText(
		"Thứ Ba, 03/11/2026",
	);
	await page
		.getByTestId("report-clamped")
		.getByRole("link", { name: "Xem Hôm nay" })
		.click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Hôm nay" }),
	).toBeVisible();
});

test("a period that has not started shows the latest one and rewrites the link", async ({
	page,
}) => {
	await openReport(page, "day", "date=2026-12-25");
	await expect(page.getByTestId("report-not-started")).toContainText(
		"Kỳ này chưa bắt đầu; đang hiển thị kỳ gần nhất đến hết ngày 03/11/2026.",
	);
	await expect(page.getByTestId("report-clamped")).toHaveCount(0);
	await expect.poll(() => currentKey(page, "day")).toBe("2026-11-03");
});

test("a day before the young store opened explains every empty card", async ({
	page,
}) => {
	await openReport(page, "day", "date=2026-08-15&store=MOCK-S2");
	await expectEveryCardSettled(page, "day");
	await expect(
		page.getByTestId("card-day-net_revenue").getByTestId("card-notice"),
	).toHaveText("Chưa có số liệu bán hàng trong ngày này.");
});

test("a store link to another report keeps its store over the stored choice", async ({
	page,
}) => {
	await openReport(page, "day", "date=2026-11-03&store=MOCK-S1");
	await expect(page.getByTestId("store-select")).toContainText(
		"Cửa hàng mẫu 1",
	);
	await page.goto(reportUrl("month", "month=2026-10&store=MOCK-S2"));
	await waitForSettledCards(page);
	await expect(page.getByTestId("store-select")).toContainText(
		"Cửa hàng mẫu 2",
	);
	await expect.poll(() => new URL(page.url()).hash).toContain("store=MOCK-S2");
});

test("the young store has no last year on net revenue", async ({ page }) => {
	await openReport(page, "day", "date=2026-11-03&store=MOCK-S2");
	await expect(page.getByTestId("store-select")).toContainText(
		"Cửa hàng mẫu 2",
	);
	const net = page.getByTestId("card-day-net_revenue");
	await expect(net.getByTestId("comparison-chip").last()).toHaveText(
		"chưa có dữ liệu năm trước",
	);
	await expectEveryCardSettled(page, "day");
	await selectStores(page, null);
	await expect.poll(() => new URL(page.url()).hash).not.toContain("store=");
	await expect(net.getByTestId("comparison-chip").last()).toContainText(
		"cùng cửa hàng (1/2)",
	);
	await selectStores(page, ["MOCK-S1"]);
	await expect.poll(() => new URL(page.url()).hash).toContain("store=MOCK-S1");
	await expect(page.getByTestId("card-day-net_revenue")).toBeVisible();
});

test("tables download as CSV with a BOM and the page prints without controls", async ({
	page,
}) => {
	await openReport(page, "day");
	await expectCsvWithBom(page, "card-day-top_items");
	await expectCsvWithBom(page, "card-day-discounts");
	await expectPrintLayout(page);
});

test("Ngày passes axe and fits 360 px", async ({ page }) => {
	await openReport(page, "day");
	await waitForCharts(page);
	await checkPage(page);
	await openReport(page, "day", "date=2026-11-03&store=MOCK-S2");
	await checkPage(page);
});

test("Ngày makes no request outside its origin and reads well in English", async ({
	page,
}) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
	await expectNoExternalRequests(page, async () => {
		await page.goto(reportUrl("day"));
		await waitForSettledCards(page);
		await page.getByRole("button", { name: "Kỳ trước" }).click();
		await waitForSettledCards(page);
		await page
			.getByTestId("report-tabs")
			.getByRole("link", { name: "Ngày" })
			.click();
		await waitForSettledCards(page);
	});
	await expectEnglishWithoutKeys(page);
});

test("the shift card numbers shifts Ca n and its CSV and print show no POS shift name or e-mail", async ({
	page,
}) => {
	await openReport(page, "day");
	await expectShiftsLabelledByNumber(
		page,
		"card-day-shifts",
		/Ca (sáng|chiều|tối)/,
	);
	expectNoConsoleErrors(page);
});
