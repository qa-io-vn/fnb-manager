import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { PHONE_WIDTH } from "./checks";

export type ReportKind = "day" | "week" | "month" | "year";

export const REPORT_CLOCK = new Date("2026-11-04T05:30:00.000Z");

export const reportSlugs: Record<ReportKind, string> = {
	day: "ngay",
	week: "tuan",
	month: "thang",
	year: "nam",
};

export const periodParams: Record<ReportKind, string> = {
	day: "date",
	week: "week",
	month: "month",
	year: "year",
};

export const cardIds: Record<ReportKind, readonly string[]> = {
	day: [
		"net_revenue",
		"invoices",
		"avg_ticket",
		"hourly",
		"top_items",
		"payments",
		"shifts",
		"discounts",
		"members",
	],
	week: [
		"net_revenue",
		"invoices",
		"avg_ticket",
		"weekday_curve",
		"movers",
		"category_mix",
		"promotions",
		"best_worst_days",
	],
	month: [
		"month_pace",
		"daily_trend",
		"pareto",
		"size_mix",
		"attach_rate",
		"new_items",
		"payment_mix",
		"discount_cost",
		"shift_stats",
		"target_progress",
	],
	year: [
		"month_matrix",
		"growth",
		"seasonality",
		"ticket_trend",
		"item_lifecycle",
		"year_over_year",
		"since_opening",
	],
};

const RAW_KEY = /\b(report|metric)\.[a-z]+[A-Za-z_]*\./;
const PRINTED_CONTENT_WIDTH_PX = 703;
const PRINT_CHART_WIDTH_PX = 660;
const DESKTOP_WIDTH_PX = 1280;
const SCREEN_HEIGHT_PX = 800;
const CHART_SVG = '[data-testid="echarts"] svg';
const SETTLE_TIMEOUT = 60_000;

const consoleErrors = new WeakMap<Page, string[]>();

export function watchConsoleErrors(page: Page): void {
	if (consoleErrors.has(page)) return;
	const errors: string[] = [];
	consoleErrors.set(page, errors);
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
}

export function expectNoConsoleErrors(page: Page): void {
	expect(consoleErrors.get(page) ?? [], "browser console errors").toEqual([]);
}

export function reportUrl(kind: ReportKind, search = ""): string {
	return `/#/bao-cao/${reportSlugs[kind]}${search === "" ? "" : `?${search}`}`;
}

export function cards(page: Page, kind: ReportKind): Locator {
	return page.locator(`[data-testid^="card-${kind}-"]`);
}

export async function waitForSettledCards(page: Page): Promise<void> {
	await expect(page.getByTestId("period-label")).toBeVisible({
		timeout: SETTLE_TIMEOUT,
	});
	await expect(page.getByTestId("report-cards")).toBeAttached({
		timeout: SETTLE_TIMEOUT,
	});
	await expect(
		page.locator('[data-testid="report-cards"] [aria-busy="true"]'),
	).toHaveCount(0, { timeout: SETTLE_TIMEOUT });
}

export async function openReport(
	page: Page,
	kind: ReportKind,
	search?: string,
	clock: Date | null = REPORT_CLOCK,
): Promise<void> {
	watchConsoleErrors(page);
	if (clock !== null) await page.clock.setFixedTime(clock);
	await page.goto(reportUrl(kind, search));
	await waitForSettledCards(page);
}

export function currentKey(page: Page, kind: ReportKind): string | null {
	const hash = new URL(page.url()).hash;
	const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
	return new URLSearchParams(query).get(periodParams[kind]);
}

export async function expectCardsPresent(
	page: Page,
	kind: ReportKind,
	ids: readonly string[] = cardIds[kind],
): Promise<void> {
	for (const id of ids) {
		await expect(page.getByTestId(`card-${kind}-${id}`), id).toBeVisible();
	}
}

export async function expectEveryCardSettled(
	page: Page,
	kind: ReportKind,
): Promise<void> {
	await waitForSettledCards(page);
	const all = cards(page, kind);
	const count = await all.count();
	for (let index = 0; index < count; index += 1) {
		const card = all.nth(index);
		const id = await card.getAttribute("data-testid");
		await expect(card, `${id} is not an error card`).not.toHaveAttribute(
			"data-state",
			"error",
		);
		const headline = (await card.getByTestId("headline").textContent()) ?? "";
		if (!/\d/.test(headline)) {
			expect(headline.trim(), `${id} headline`).toBe("—");
			await expect(
				card.getByTestId("card-notice"),
				`${id} notice`,
			).toBeVisible();
		}
		const sentence = (await card.getByTestId("sentence").textContent()) ?? "";
		expect(sentence.trim(), `${id} sentence`).not.toBe("");
		const text = (await card.textContent()) ?? "";
		expect(RAW_KEY.test(text), `${id} shows a raw key`).toBe(false);
	}
	expectNoConsoleErrors(page);
}

export async function expectDeepLinkRoundTrip(
	page: Page,
	kind: ReportKind,
	key: string,
): Promise<void> {
	await openReport(page, kind, `${periodParams[kind]}=${key}`);
	expect(currentKey(page, kind)).toBe(key);
	const label = await page.getByTestId("period-label").textContent();
	await page.reload();
	await waitForSettledCards(page);
	expect(currentKey(page, kind)).toBe(key);
	await expect(page.getByTestId("period-label")).toHaveText(label ?? "");
}

export async function expectStepping(
	page: Page,
	kind: ReportKind,
): Promise<void> {
	await waitForSettledCards(page);
	const start = currentKey(page, kind);
	expect(start).not.toBeNull();
	const next = page.getByRole("button", { name: "Kỳ sau" });
	const previous = page.getByRole("button", { name: "Kỳ trước" });
	await expect(next).toBeDisabled();
	await previous.click();
	await expect.poll(() => currentKey(page, kind)).not.toBe(start);
	await waitForSettledCards(page);
	await expect(page.getByRole("heading", { level: 1 })).not.toBeFocused();
	await next.click();
	await expect.poll(() => currentKey(page, kind)).toBe(start);
	await waitForSettledCards(page);
	await expect(next).toBeDisabled();
}

export async function selectStores(
	page: Page,
	ids: readonly string[] | null,
): Promise<void> {
	const trigger = page.getByTestId("store-select");
	if (!(await trigger.isVisible()))
		await page.getByTestId("scope-summary").click();
	await trigger.click();
	const all = page.locator('input[data-store-id="all"]');
	if (ids === null) {
		if (!(await all.isChecked())) await all.check();
	} else {
		const boxes = page.locator(
			'input[data-store-id]:not([data-store-id="all"])',
		);
		const count = await boxes.count();
		const wanted = new Set(ids);
		for (let index = 0; index < count; index += 1) {
			const box = boxes.nth(index);
			const id = await box.getAttribute("data-store-id");
			if (id !== null && wanted.has(id) && !(await box.isChecked())) {
				await box.check();
			}
		}
		for (let index = 0; index < count; index += 1) {
			const box = boxes.nth(index);
			const id = await box.getAttribute("data-store-id");
			if (id !== null && !wanted.has(id) && (await box.isChecked())) {
				await box.uncheck();
			}
		}
	}
	await page.keyboard.press("Escape");
	await waitForSettledCards(page);
}

export async function expectCsvWithBom(
	page: Page,
	cardTestId: string,
): Promise<void> {
	const card = page.getByTestId(cardTestId);
	const downloading = page.waitForEvent("download");
	await card
		.getByRole("button", { name: /Tải CSV|Download CSV/ })
		.first()
		.click();
	const download = await downloading;
	const path = await download.path();
	const bytes = await readFile(path);
	expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
	const header = bytes.subarray(3).toString("utf8").split("\r\n")[0] ?? "";
	expect(header.split(",").length).toBeGreaterThan(1);
	expect(download.suggestedFilename()).toMatch(/^[A-Za-z0-9_-]+\.csv$/);
}

function elementsOutsideTheirCard(
	page: Page,
	selector: string,
): Promise<string[]> {
	return page.evaluate(
		(inside) =>
			[
				...document.querySelectorAll('[data-testid="report-cards"] article'),
			].flatMap((card) => {
				const edge = card.getBoundingClientRect().right;
				return [...card.querySelectorAll(inside)]
					.filter((element) => element.getBoundingClientRect().right > edge)
					.map(
						(element) =>
							`${card.getAttribute("data-testid")} ${element.tagName}`,
					);
			}),
		selector,
	);
}

function pageOverflowPx(page: Page): Promise<number> {
	return page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);
}

function widestChartPx(page: Page): Promise<number> {
	return page.evaluate(
		(selector) =>
			Math.max(
				0,
				...[...document.querySelectorAll(selector)].map((chart) =>
					Math.round(chart.getBoundingClientRect().width),
				),
			),
		CHART_SVG,
	);
}

async function expectScreenLayoutBack(page: Page): Promise<void> {
	const screenSize = page.viewportSize();
	try {
		for (const width of [PHONE_WIDTH, DESKTOP_WIDTH_PX]) {
			await page.setViewportSize({ width, height: SCREEN_HEIGHT_PX });
			await expect
				.poll(() => elementsOutsideTheirCard(page, CHART_SVG), {
					message: `charts fit their cards at ${width} px after printing`,
				})
				.toEqual([]);
			await expect
				.poll(() => pageOverflowPx(page), {
					message: `no sideways scroll at ${width} px after printing`,
				})
				.toBeLessThanOrEqual(0);
		}
	} finally {
		if (screenSize !== null) await page.setViewportSize(screenSize);
	}
}

async function expectPrintEventsLeaveScreenLayout(page: Page): Promise<void> {
	await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
	try {
		await expect
			.poll(() => widestChartPx(page), {
				message: "charts take the print width on beforeprint",
			})
			.toBe(PRINT_CHART_WIDTH_PX);
	} finally {
		await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
	}
	await expectScreenLayoutBack(page);
}

export async function expectPrintLayout(page: Page): Promise<void> {
	const screenSize = page.viewportSize();
	await page.setViewportSize({
		width: PRINTED_CONTENT_WIDTH_PX,
		height: screenSize?.height ?? PRINTED_CONTENT_WIDTH_PX,
	});
	await page.emulateMedia({ media: "print" });
	try {
		await expect(page.getByTestId("report-tabs")).toBeHidden();
		await expect(page.getByTestId("period-navigator")).toBeHidden();
		await expect(page.getByTestId("bottom-navigation")).toBeHidden();
		await expect(page.getByTestId("side-rail")).toBeHidden();
		await expect(page.getByTestId("print-summary")).toBeVisible();
		await expect(page.locator("button:visible")).toHaveCount(
			await page.locator("th button:visible").count(),
		);
		const figures = page.locator('[data-testid="report-cards"] figure');
		const count = await figures.count();
		for (let index = 0; index < count; index += 1) {
			await expect(figures.nth(index).locator(CHART_SVG)).toBeVisible();
		}
		await expect
			.poll(() => elementsOutsideTheirCard(page, `${CHART_SVG}, table`))
			.toEqual([]);
	} finally {
		await page.emulateMedia({ media: "screen" });
		if (screenSize !== null) await page.setViewportSize(screenSize);
	}
	await expectScreenLayoutBack(page);
	await expectPrintEventsLeaveScreenLayout(page);
	expectNoConsoleErrors(page);
}

export async function expectNoExternalRequests(
	page: Page,
	action: () => Promise<void>,
): Promise<void> {
	const requests: string[] = [];
	const record = (request: { url(): string }) => requests.push(request.url());
	page.on("request", record);
	try {
		await action();
	} finally {
		page.off("request", record);
	}
	const origin = new URL(page.url()).origin;
	expect(
		requests.filter(
			(url) => !url.startsWith(origin) && !url.startsWith("data:"),
		),
	).toEqual([]);
}

export async function expectEnglishWithoutKeys(page: Page): Promise<void> {
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		await expect(page.getByTestId("report-tabs")).toContainText("Day");
		await waitForSettledCards(page);
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_KEY.test(text)).toBe(false);
		expect(text).not.toContain("hôm trước");
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
}

export async function headlineExact(card: Locator): Promise<string | null> {
	return card.getByTestId("headline").getAttribute("data-exact");
}
