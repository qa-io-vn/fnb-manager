import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { waitForCharts } from "./checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "./reports";

export type ThemeKind = "revenue" | "hours";

export const themeSlugs: Record<ThemeKind, string> = {
	revenue: "doanh-thu",
	hours: "gio-ngay",
};

export const themeCardIds: Record<ThemeKind, readonly string[]> = {
	revenue: ["net_revenue", "trend", "invoices", "avg_ticket", "store_share"],
	hours: ["heatmap", "peak_dead", "weekday", "productivity", "shift_windows"],
};

const RAW_KEY = /\b(report|metric|theme)\.[a-z]+[A-Za-z_]*\./;
const SETTLE_TIMEOUT = 60_000;
const PRINTED_CONTENT_WIDTH_PX = 680;

export function themeUrl(kind: ThemeKind, search = ""): string {
	return `/#/chu-de/${themeSlugs[kind]}${search === "" ? "" : `?${search}`}`;
}

export function themeCards(page: Page, kind: ThemeKind): Locator {
	return page.locator(`[data-testid^="card-${kind}-"]`);
}

export function themeCard(page: Page, kind: ThemeKind, id: string): Locator {
	return page.getByTestId(`card-${kind}-${id}`);
}

export async function waitForSettledThemeCards(page: Page): Promise<void> {
	await expect(page.getByTestId("range-label")).toBeVisible({
		timeout: SETTLE_TIMEOUT,
	});
	await expect(page.getByTestId("report-cards")).toBeAttached({
		timeout: SETTLE_TIMEOUT,
	});
	await expect(
		page.locator('[data-testid="report-cards"] [aria-busy="true"]'),
	).toHaveCount(0, { timeout: SETTLE_TIMEOUT });
	await expect
		.poll(() =>
			page.evaluate(() =>
				[
					...document.querySelectorAll('[data-testid="report-cards"] > *'),
				].every((card) => getComputedStyle(card).opacity === "1"),
			),
		)
		.toBe(true);
}

export async function openTheme(
	page: Page,
	kind: ThemeKind,
	search?: string,
	clock: Date | null = REPORT_CLOCK,
): Promise<void> {
	watchConsoleErrors(page);
	if (clock !== null) await page.clock.setFixedTime(clock);
	await page.goto(themeUrl(kind, search));
	await waitForSettledThemeCards(page);
}

export function themeSearch(page: Page): URLSearchParams {
	const hash = new URL(page.url()).hash;
	return new URLSearchParams(
		hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "",
	);
}

export async function expectEveryThemeCardSettled(
	page: Page,
	kind: ThemeKind,
): Promise<void> {
	await waitForSettledThemeCards(page);
	const all = themeCards(page, kind);
	const count = await all.count();
	expect(count).toBeGreaterThan(0);
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
		}
		const sentence = (await card.getByTestId("sentence").textContent()) ?? "";
		expect(sentence.trim(), `${id} sentence`).not.toBe("");
		const text = (await card.textContent()) ?? "";
		expect(RAW_KEY.test(text), `${id} shows a raw key`).toBe(false);
	}
	expectNoConsoleErrors(page);
}

export async function choosePreset(page: Page, name: string): Promise<void> {
	const preset = page.getByTestId("range-presets").getByRole("radio", { name });
	await preset.click();
	await expect(preset).toBeChecked();
	await waitForSettledThemeCards(page);
}

export async function expectCsvTablesWithBom(
	page: Page,
	card: Locator,
): Promise<string[]> {
	const buttons = card.getByRole("button", { name: /Tải CSV|Download CSV/ });
	const count = await buttons.count();
	const headers: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const downloading = page.waitForEvent("download");
		await buttons.nth(index).click();
		const download = await downloading;
		const bytes = await readFile(await download.path());
		expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
		const header =
			new TextDecoder("utf-8", { fatal: true })
				.decode(bytes.subarray(3))
				.split("\r\n")[0] ?? "";
		expect(header.split(",").length).toBeGreaterThan(1);
		expect(download.suggestedFilename()).toMatch(
			/^[a-z-]+-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}(-2)?\.csv$/,
		);
		headers.push(header);
	}
	return headers;
}

export async function expectThemePrintLayout(page: Page): Promise<void> {
	const screenSize = page.viewportSize();
	await page.setViewportSize({
		width: PRINTED_CONTENT_WIDTH_PX,
		height: screenSize?.height ?? PRINTED_CONTENT_WIDTH_PX,
	});
	await page.emulateMedia({ media: "print" });
	try {
		await expect(page.getByTestId("theme-tabs")).toBeHidden();
		await expect(page.getByTestId("range-picker")).toBeHidden();
		await expect(page.getByTestId("print-summary")).toBeVisible();
		await waitForCharts(page);
	} finally {
		await page.emulateMedia({ media: "screen" });
		if (screenSize !== null) await page.setViewportSize(screenSize);
	}
	await expect(page.getByTestId("range-picker")).toBeVisible();
	expectNoConsoleErrors(page);
}

export async function expectThemeInEnglish(
	page: Page,
	title: string,
): Promise<void> {
	await page.getByRole("button", { name: "EN", exact: true }).click();
	try {
		await expect(
			page.getByRole("heading", { level: 1, name: title }),
		).toBeVisible();
		await waitForSettledThemeCards(page);
		const text = (await page.locator("main").textContent()) ?? "";
		expect(RAW_KEY.test(text)).toBe(false);
	} finally {
		await page.getByRole("button", { name: "VI", exact: true }).click();
	}
}
