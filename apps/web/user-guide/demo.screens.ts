import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { waitForCharts } from "../e2e/support/checks";
import {
	REPORT_CLOCK,
	type ReportKind,
	reportUrl,
	waitForSettledCards,
} from "../e2e/support/reports";

const SCREENSHOTS = join(process.cwd(), "..", "..", "docs", "user-guide");
const PHONE = { width: 390, height: 844 };
const COMPUTER = { width: 1280, height: 800 };
const TALL_COMPUTER = { width: 1280, height: 2400 };
const A4_WIDTH_PX = 794;

const reportFiles: Record<ReportKind, string> = {
	day: "report-ngay",
	week: "report-tuan",
	month: "report-thang",
	year: "report-nam",
};

function file(name: string): string {
	return join(SCREENSHOTS, `${name}.png`);
}

async function openToday(page: Page): Promise<void> {
	await page.goto("/");
	await expect(page.getByTestId("card-yesterday-net_revenue")).toBeVisible();
	await waitForCharts(page);
}

async function openReportPage(
	page: Page,
	kind: ReportKind,
	search = "",
): Promise<void> {
	await page.goto(reportUrl(kind, search));
	await waitForSettledCards(page);
	await waitForCharts(page);
}

async function shootElement(locator: Locator, name: string): Promise<void> {
	await waitForCharts(locator.page());
	await locator.screenshot({ path: file(name), animations: "disabled" });
}

async function shootViewport(page: Page, name: string): Promise<void> {
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({ path: file(name), animations: "disabled" });
}

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(REPORT_CLOCK);
});

test("Hôm nay on a phone and on a computer", async ({ page }) => {
	await page.setViewportSize(PHONE);
	await openToday(page);
	await shootViewport(page, "today-phone");
	await page.setViewportSize(COMPUTER);
	await openToday(page);
	await shootViewport(page, "today-computer");
});

test("Hôm nay in English and in the dark colour scheme", async ({ page }) => {
	await page.setViewportSize(COMPUTER);
	await openToday(page);
	await page.getByRole("button", { name: "EN" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "Today" }),
	).toBeVisible();
	await shootViewport(page, "today-english");
	await page.getByRole("button", { name: "VI" }).click();
	await page.setViewportSize(PHONE);
	await page.emulateMedia({ colorScheme: "dark" });
	await openToday(page);
	await shootViewport(page, "today-dark-phone");
});

test("the store choice on a computer and the folded controls on a phone", async ({
	page,
}) => {
	await page.setViewportSize(COMPUTER);
	await openToday(page);
	await page.getByTestId("store-select").click();
	await page.screenshot({
		path: file("store-choice"),
		clip: { x: 0, y: 0, width: COMPUTER.width, height: 420 },
		animations: "disabled",
	});
	await page.keyboard.press("Escape");
	await page.setViewportSize(PHONE);
	await openToday(page);
	await page.getByTestId("scope-summary").click();
	await shootViewport(page, "controls-phone");
});

for (const kind of ["day", "week", "month", "year"] as const) {
	test(`the ${kind} report on a computer`, async ({ page }) => {
		await page.setViewportSize(COMPUTER);
		await openReportPage(page, kind);
		await shootViewport(page, reportFiles[kind]);
	});
}

test("the period navigator, a card and its like-for-like chip", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openReportPage(page, "day");
	await shootElement(page.getByTestId("period-navigator"), "period-navigator");
	const card = page.getByTestId("card-day-net_revenue");
	await expect(card).toContainText("cùng cửa hàng (1/2)");
	await shootElement(card, "card-anatomy");
});

test("the printed report", async ({ page }) => {
	await page.setViewportSize({ width: A4_WIDTH_PX, height: 1123 });
	await openReportPage(page, "day");
	await page.emulateMedia({ media: "print" });
	await expect(page.getByTestId("print-summary")).toBeVisible();
	await shootViewport(page, "report-print");
});

test("the demo banner and a page that is coming", async ({ page }) => {
	await page.setViewportSize(COMPUTER);
	await openToday(page);
	await shootElement(page.getByTestId("demo-banner"), "demo-banner");
	await page.goto("/#/ke-hoach");
	await expect(page.getByTestId("placeholder-phase")).toBeVisible();
	await shootViewport(page, "coming-soon");
});
