import { join } from "node:path";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { waitForCharts } from "../e2e/support/checks";
import {
	REPORT_CLOCK,
	type ReportKind,
	reportUrl,
	waitForSettledCards,
} from "../e2e/support/reports";
import {
	type ThemeKind,
	themeCard,
	themeUrl,
	waitForSettledThemeCards,
} from "../e2e/support/themes";

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

async function openThemePage(
	page: Page,
	kind: ThemeKind,
	search = "",
): Promise<void> {
	await page.goto(themeUrl(kind, search));
	await waitForSettledThemeCards(page);
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

test("the Ngày shift card", async ({ page }) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openReportPage(page, "day");
	const card = page.getByTestId("card-day-shifts");
	await expect(card).toContainText("Ca 1");
	await shootElement(card, "card-shifts");
});

test("the thematic reports: Doanh thu, the range picker and the Giờ & ngày heat table", async ({
	page,
}) => {
	await page.setViewportSize(COMPUTER);
	await openThemePage(page, "revenue");
	await shootViewport(page, "theme-doanh-thu");
	await shootElement(page.getByTestId("range-picker"), "theme-range-picker");
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "hours", "range=28d&store=MOCK-S1");
	await shootElement(
		themeCard(page, "hours", "heatmap"),
		"theme-gio-ngay-heatmap",
	);
});

test("the Thực đơn matrix and its margins card", async ({ page }) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "menu", "range=28d&store=MOCK-S1");
	await shootElement(
		themeCard(page, "menu", "menu_matrix"),
		"theme-thuc-don-matrix",
	);
	await shootElement(
		themeCard(page, "menu", "margins"),
		"theme-thuc-don-margins",
	);
	for (const [card, name] of [
		["movers", "theme-thuc-don-movers"],
		["category_mix", "theme-thuc-don-category-mix"],
		["size_mix", "theme-thuc-don-size-mix"],
		["attach", "theme-thuc-don-attach"],
		["pairs", "theme-thuc-don-pairs"],
		["preferences", "theme-thuc-don-preferences"],
	] as const) {
		await shootElement(themeCard(page, "menu", card), name);
	}
});

test("the Thanh toán payment mix and cash trend", async ({ page }) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "payments", "range=28d&store=MOCK-S1");
	await shootElement(
		themeCard(page, "payments", "payment_mix"),
		"theme-thanh-toan-mix",
	);
	await shootElement(
		themeCard(page, "payments", "cash_trend"),
		"theme-thanh-toan-cash-trend",
	);
	await shootElement(
		themeCard(page, "payments", "drawer"),
		"theme-thanh-toan-drawer",
	);
	await shootElement(
		themeCard(page, "payments", "fees"),
		"theme-thanh-toan-fees",
	);
});

test("the Khuyến mãi discount cost, vouchers and promotion lift", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "promotions", "range=28d");
	await shootElement(
		themeCard(page, "promotions", "discount_cost"),
		"theme-khuyen-mai-cost",
	);
	await shootElement(
		themeCard(page, "promotions", "vouchers"),
		"theme-khuyen-mai-vouchers",
	);
	await shootElement(
		themeCard(page, "promotions", "lift"),
		"theme-khuyen-mai-lift-dash",
	);
	await openThemePage(
		page,
		"promotions",
		`from=2026-03-03&to=2026-06-02&promo=${encodeURIComponent("bill:Giảm 5% hóa đơn")}&cmp=prior_weeks`,
	);
	await expect(
		themeCard(page, "promotions", "lift").getByTestId("sentence"),
	).toContainText("lỗ ròng");
	await shootElement(
		themeCard(page, "promotions", "lift"),
		"theme-khuyen-mai-lift",
	);
});

test("the Khuyến mãi catalogue and rule cards", async ({ page }) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "promotions", "range=28d");
	await expect(
		themeCard(page, "promotions", "rule_days").getByTestId("sentence"),
	).toContainText("được cho là đã bãi bỏ");
	for (const [card, name] of [
		["catalogue", "theme-khuyen-mai-catalogue"],
		["rule_cap", "theme-khuyen-mai-rule-cap"],
		["rule_days", "theme-khuyen-mai-rule-days"],
	] as const) {
		await shootElement(themeCard(page, "promotions", card), name);
	}
});

test("the Ca & két tiền sales, drawer and adjustments cards", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "shifts", "range=28d&store=MOCK-S1");
	for (const [card, name] of [
		["shift_sales", "theme-ca-ket-tien-sales"],
		["drawer", "theme-ca-ket-tien-drawer"],
		["adjustments", "theme-ca-ket-tien-adjustments"],
	] as const) {
		await shootElement(themeCard(page, "shifts", card), name);
	}
});

test("the Ca & két tiền cashier card", async ({ page }) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "shifts", "range=91d&store=MOCK-S1");
	await shootElement(
		themeCard(page, "shifts", "cashiers"),
		"theme-ca-ket-tien-cashiers",
	);
});

test("the So sánh store figures, same-day shape and since-opening cards", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "stores", "range=28d");
	for (const [card, name] of [
		["kpis", "theme-so-sanh-kpis"],
		["same_day", "theme-so-sanh-same-day"],
		["since_opening", "theme-so-sanh-since-opening"],
	] as const) {
		await shootElement(themeCard(page, "stores", card), name);
	}
});

test("the Chất lượng dữ liệu e-invoice finding and the uncategorised item with their fixes", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await openThemePage(page, "quality", "range=28d");
	for (const [card, name] of [
		["compliance", "theme-chat-luong-compliance"],
		["uncategorised", "theme-chat-luong-uncategorised"],
		["verification", "theme-chat-luong-verification"],
	] as const) {
		await shootElement(themeCard(page, "quality", card), name);
	}
});

test("Cài đặt: Ngưỡng báo cáo and the choice kept on this device", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/bao-cao");
	await expect(page.getByTestId("thresholds-form")).toBeVisible();
	await shootElement(page.getByTestId("settings-layout"), "settings-bao-cao");
	await page.setViewportSize(PHONE);
	await shootElement(
		page.getByTestId("device-csv-choice"),
		"settings-thiet-bi-phone",
	);
});

test("Cài đặt: Cửa hàng with a store's POS facts and its own settings", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/cua-hang");
	const store = page.getByTestId("store-profile").first();
	await expect(store.getByTestId("store-pos-facts")).toBeVisible();
	await expect(page.getByTestId("tenant-profile")).toBeVisible();
	await shootElement(store, "settings-cua-hang");
});

test("Cài đặt: Phân loại with a suggestion for an unassigned item type", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/phan-loai");
	const form = page.getByTestId("roles-form");
	await expect(form).toBeVisible();
	await expect(form.getByText(/món đã bán/).first()).toBeVisible();
	await form
		.locator('[data-testid="role-row"][data-type="TYPE-007"]')
		.getByTestId("role-select")
		.selectOption("");
	await expect(page.getByTestId("roles-apply-suggestions")).toBeVisible();
	await shootElement(page.getByTestId("mapping-page"), "settings-phan-loai");
});

test("Cài đặt: Phân loại, the item categories with the uncategorised demo item and a search, then the payment kinds", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/phan-loai?tab=nhom-mon");
	const categories = page.getByTestId("categories-form");
	await expect(
		categories.getByTestId("categories-uncategorised-list"),
	).toBeVisible();
	await categories.getByRole("searchbox", { name: "Tìm món" }).fill("banh");
	await expect(categories.getByTestId("categories-search-list")).toBeVisible();
	await shootElement(page.getByTestId("mapping-page"), "settings-nhom-mon");
	await page
		.getByTestId("mapping-tabs")
		.getByRole("link", { name: "Loại thanh toán" })
		.click();
	await expect(page.getByTestId("payment-kinds-form")).toBeVisible();
	await shootElement(
		page.getByTestId("mapping-page"),
		"settings-loai-thanh-toan",
	);
});

test("Cài đặt: Ngày lễ with a day off of the business and the national days of the year", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/ngay-le");
	await expect(page.getByTestId("holidays-global")).toBeVisible();
	const form = page.getByTestId("holidays-add");
	await form.getByLabel("Ngày", { exact: true }).fill("2026-12-24");
	await form.getByLabel("Tên", { exact: true }).fill("Nghỉ sửa quán");
	await form.getByRole("button", { name: "Thêm" }).click();
	await expect(page.getByTestId("holiday-delete")).toHaveCount(1);
	await shootElement(page.getByTestId("holidays-page"), "settings-ngay-le");
});

test("Cài đặt: Dữ liệu nhập tay, item costs with a later change and its history, then the margins they bring to Thực đơn", async ({
	page,
}) => {
	await page.setViewportSize({ width: COMPUTER.width, height: 3200 });
	await page.goto("/#/cai-dat/du-lieu-nhap-tay?tab=gia-von");
	const costs = page.getByTestId("costs-form");
	await expect(costs).toHaveAttribute("data-sales", "ready");
	const rows = costs.getByTestId("cost-row");
	for (const [index, amount] of ["18000", "14000", "16000"].entries()) {
		await rows.nth(index).getByLabel("Giá vốn mới").fill(amount);
	}
	await page.getByTestId("settings-save").click();
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await rows.first().getByLabel("Giá vốn mới").fill("19000");
	await page.getByTestId("settings-save").click();
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	await costs.getByRole("searchbox", { name: "Tìm món" }).fill("matcha");
	await expect(rows.first()).toContainText("Matcha Latte");
	await rows.first().getByTestId("cost-history-toggle").click();
	await rows.nth(1).getByLabel("Giá vốn mới").fill("21000");
	await rows.nth(1).getByLabel("Giá vốn mới").blur();
	await shootElement(page.getByTestId("manual-page"), "settings-gia-von");
	await page.setViewportSize(COMPUTER);
	await page.getByTestId("settings-cancel").click();
	await page
		.getByRole("navigation", { name: "Điều hướng chính" })
		.getByRole("link", { name: "Chủ đề" })
		.click();
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Thực đơn" })
		.click();
	await waitForSettledThemeCards(page);
	await expect(
		themeCard(page, "menu", "margins").getByRole("table", {
			name: "Biên lợi nhuận các món có giá vốn",
		}),
	).toBeVisible();
	await shootElement(
		themeCard(page, "menu", "margins"),
		"theme-thuc-don-margins-costed",
	);
});

test("Cài đặt: Pháp lý with the draft privacy notice, its editor on the skeleton and the publication's confirmation", async ({
	page,
}) => {
	await page.setViewportSize(TALL_COMPUTER);
	await page.goto("/#/cai-dat/phap-ly");
	const privacy = page.locator(
		'[data-testid="legal-kind"][data-kind="privacy_notice"]',
	);
	const vietnamese = privacy.locator(
		'[data-testid="legal-group"][data-language="vi"]',
	);
	const draft = vietnamese.getByTestId("legal-version").first();
	await expect(draft.getByTestId("legal-publish")).toBeVisible();
	await shootElement(privacy, "settings-phap-ly");
	const english = privacy.locator(
		'[data-testid="legal-group"][data-language="en"]',
	);
	await english.getByTestId("legal-new").click();
	const editor = english.getByTestId("legal-editor");
	await editor.getByLabel("Tiêu đề").fill("Privacy notice");
	await editor.getByTestId("legal-skeleton").click();
	await expect(editor.getByTestId("legal-body")).toHaveValue(/^## /);
	await editor.getByLabel("Tiêu đề").focus();
	await shootElement(editor, "settings-phap-ly-editor");
	await editor.getByTestId("legal-close").click();
	await draft.getByTestId("legal-publish").click();
	await expect(draft.getByTestId("legal-confirm")).toBeVisible();
	await shootElement(draft, "settings-phap-ly-confirm");
});

test("Cài đặt: Dữ liệu nhập tay, a cost CSV in the import preview with each row's outcome and the date-order choice", async ({
	page,
}) => {
	await page.setViewportSize({ width: COMPUTER.width, height: 2400 });
	await page.goto("/#/cai-dat/du-lieu-nhap-tay?tab=gia-von");
	const costs = page.getByTestId("costs-form");
	await expect(costs).toHaveAttribute("data-sales", "ready");
	const rows = costs.getByTestId("cost-row");
	const ids: string[] = [];
	for (let index = 0; index < 5; index += 1) {
		ids.push((await rows.nth(index).getAttribute("data-item")) ?? "");
	}
	await rows.first().getByLabel("Giá vốn mới").fill("18000");
	await page.getByTestId("settings-save").click();
	await expect(page.getByTestId("settings-save-bar-status")).toHaveText(
		"Đã lưu.",
	);
	const file = [
		"ma_mon,ten_mon,size,ma_cua_hang,gia_von,tu_ngay",
		`${ids[0]},,,,18000,2023-01-01`,
		`${ids[1]},,,,14.000,`,
		`${ids[2]},,,CH1,16000,01/12/2026`,
		`${ids[3]},,,,"8333,33",`,
		`${ids[4]},,,,99000000,2024-01-01`,
		"KHONG-CO,,,,12000,",
	].join("\r\n");
	const choosing = page.waitForEvent("filechooser");
	await costs.getByRole("button", { name: "Nhập từ CSV" }).click();
	await (await choosing).setFiles({
		name: "gia-von-thang-11.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(file),
	});
	await expect(costs.getByTestId("cost-import-row")).toHaveCount(5);
	await shootElement(costs.getByTestId("costs-csv"), "settings-gia-von-import");
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
