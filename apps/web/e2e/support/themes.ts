import { readFile } from "node:fs/promises";
import { expect, type Locator, type Page } from "@playwright/test";
import { waitForCharts } from "./checks";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "./reports";

export type ThemeKind =
	| "revenue"
	| "hours"
	| "menu"
	| "payments"
	| "promotions"
	| "shifts"
	| "stores"
	| "quality";

export const themeSlugs: Record<ThemeKind, string> = {
	revenue: "doanh-thu",
	hours: "gio-ngay",
	menu: "thuc-don",
	payments: "thanh-toan",
	promotions: "khuyen-mai",
	shifts: "ca-ket-tien",
	stores: "so-sanh",
	quality: "chat-luong",
};

export const themeCardIds: Record<ThemeKind, readonly string[]> = {
	revenue: ["net_revenue", "trend", "invoices", "avg_ticket", "store_share"],
	hours: ["heatmap", "peak_dead", "weekday", "productivity", "shift_windows"],
	menu: [
		"menu_matrix",
		"margins",
		"movers",
		"category_mix",
		"size_mix",
		"attach",
		"pairs",
		"preferences",
	],
	payments: ["payment_mix", "cash_trend", "drawer", "fees"],
	promotions: [
		"discount_cost",
		"vouchers",
		"lift",
		"catalogue",
		"rule_cap",
		"rule_days",
		"redemptions",
	],
	shifts: ["shift_sales", "drawer", "adjustments", "cashiers"],
	stores: ["kpis", "same_day", "since_opening"],
	quality: [
		"compliance",
		"uncategorised",
		"costs",
		"verification",
		"payments",
		"modifiers",
		"customers",
	],
};

export const shiftNumberedCardIds: readonly string[] = [
	"shift_sales",
	"drawer",
	"adjustments",
];

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

const BOM = [0xef, 0xbb, 0xbf];
const SORT_ARROWS = /[↑↓↕]\s*$/;
const PERCENT_HEADER_SUFFIX = " (%)";
const PREFERENCES_STORAGE_KEY = "fnb.preferences.v1";
const SEMICOLON_NUMBER_WITH_DECIMALS = /(^|;)-?\d+,\d+(?=;|$)/m;
const POINT_DECIMAL_NUMBER = /(^|;)-?\d+\.\d+(?=;|$)/m;

type CsvDialect = "comma" | "semicolon";

const THEME_CSV_FILE_NAME =
	/^[a-z-]+-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}(-2)?\.csv$/;

interface CsvDownload {
	readonly header: string;
	readonly text: string;
}

function headerCells(line: string, separator: string): string[] {
	const cells: string[] = [];
	let current = "";
	let quoted = false;
	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		if (quoted) {
			if (character === '"' && line[index + 1] === '"') {
				current += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				current += character;
			}
		} else if (character === '"') {
			quoted = true;
		} else if (character === separator) {
			cells.push(current);
			current = "";
		} else {
			current += character;
		}
	}
	cells.push(current);
	return cells;
}

async function columnLabelsOf(button: Locator): Promise<string[]> {
	const table = button
		.locator("xpath=ancestor::div[.//table][1]")
		.locator("table")
		.first();
	const texts = await table.locator("thead th").allTextContents();
	return texts.map((text) => text.replace(SORT_ARROWS, "").trim());
}

async function downloadCardTables(
	page: Page,
	card: Locator,
	dialect: CsvDialect,
	fileName: RegExp | null,
): Promise<CsvDownload[]> {
	const separator = dialect === "semicolon" ? ";" : ",";
	const buttons = card.getByRole("button", { name: /Tải CSV|Download CSV/ });
	const count = await buttons.count();
	const downloads: CsvDownload[] = [];
	for (let index = 0; index < count; index += 1) {
		const button = buttons.nth(index);
		const labels = await columnLabelsOf(button);
		const downloading = page.waitForEvent("download");
		await button.click();
		const download = await downloading;
		const bytes = await readFile(await download.path());
		expect([...bytes.subarray(0, 3)]).toEqual(BOM);
		const text = new TextDecoder("utf-8", { fatal: true }).decode(
			bytes.subarray(3),
		);
		const lines = text.split("\r\n");
		expect(lines.at(-1)).toBe("");
		expect(text).not.toMatch(/^sep=/m);
		const header = lines[0] ?? "";
		const cells = headerCells(header, separator);
		expect(cells.length).toBeGreaterThan(1);
		expect(cells).toEqual(
			labels.map((label, column) =>
				cells[column] === `${label}${PERCENT_HEADER_SUFFIX}`
					? `${label}${PERCENT_HEADER_SUFFIX}`
					: label,
			),
		);
		if (dialect === "semicolon") {
			expect(text).not.toMatch(POINT_DECIMAL_NUMBER);
		}
		if (fileName !== null) {
			expect(download.suggestedFilename()).toMatch(fileName);
		}
		downloads.push({ header, text });
	}
	return downloads;
}

export async function expectCsvTablesWithBom(
	page: Page,
	card: Locator,
): Promise<string[]> {
	return (
		await downloadCardTables(page, card, "comma", THEME_CSV_FILE_NAME)
	).map((download) => download.header);
}

export async function csvTablesWithBom(
	page: Page,
	card: Locator,
): Promise<string[]> {
	return (
		await downloadCardTables(page, card, "comma", THEME_CSV_FILE_NAME)
	).map((download) => download.text);
}

export async function expectSemicolonCsvTables(
	page: Page,
	card: Locator,
): Promise<string[]> {
	return (
		await downloadCardTables(page, card, "semicolon", THEME_CSV_FILE_NAME)
	).map((download) => download.text);
}

export function expectDecimalCommas(texts: readonly string[]): void {
	expect(texts.length).toBeGreaterThan(0);
	expect(texts.join("\r\n")).toMatch(SEMICOLON_NUMBER_WITH_DECIMALS);
}

export async function chooseSemicolonCsv(page: Page): Promise<void> {
	await page.addInitScript((key) => {
		const stored = JSON.parse(window.localStorage.getItem(key) ?? "{}");
		window.localStorage.setItem(
			key,
			JSON.stringify({ ...stored, csvDialect: "semicolon" }),
		);
	}, PREFERENCES_STORAGE_KEY);
}

export async function expectSemicolonCsv(
	page: Page,
	card: Locator,
): Promise<string> {
	const [first] = await downloadCardTables(page, card, "semicolon", null);
	const text = first?.text ?? "";
	expect(text).toMatch(SEMICOLON_NUMBER_WITH_DECIMALS);
	return text;
}

export async function expectRangeRoundTrip(
	page: Page,
	kind: ThemeKind,
): Promise<void> {
	await openTheme(page, kind, "from=2026-10-08&to=2026-10-21");
	expect(themeSearch(page).get("from")).toBe("2026-10-08");
	await expect(page.getByTestId("range-label")).toContainText("14 ngày");
	await page.reload();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-10-08");
	expect(themeSearch(page).get("to")).toBe("2026-10-21");
	await page.getByRole("button", { name: "Khoảng trước" }).click();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-09-24");
	expect(themeSearch(page).get("to")).toBe("2026-10-07");
	await page.goBack();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-10-08");
	expect(themeSearch(page).get("to")).toBe("2026-10-21");
}

export async function expectThemePrintLayout(page: Page): Promise<void> {
	const screenSize = page.viewportSize();
	await page.setViewportSize({
		width: PRINTED_CONTENT_WIDTH_PX,
		height: screenSize?.height ?? PRINTED_CONTENT_WIDTH_PX,
	});
	const title =
		(await page.getByRole("heading", { level: 1 }).textContent())?.trim() ?? "";
	const span =
		((await page.getByTestId("range-label").textContent()) ?? "").split(
			" · ",
		)[0] ?? "";
	await page.emulateMedia({ media: "print" });
	try {
		await expect(page.getByTestId("theme-tabs")).toBeHidden();
		await expect(page.getByTestId("range-picker")).toBeHidden();
		await expect(page.getByTestId("bottom-navigation")).toBeHidden();
		await expect(page.getByTestId("side-rail")).toBeHidden();
		const summary = page.getByTestId("print-summary");
		await expect(summary).toBeVisible();
		await expect(summary).toContainText(`${title} · ${span.trim()} · `);
		await expect(summary).toContainText("đến hết ngày");
		await expect(page.locator("button:visible")).toHaveCount(
			await page.locator("th button:visible").count(),
		);
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
