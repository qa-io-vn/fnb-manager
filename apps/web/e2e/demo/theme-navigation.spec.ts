import { expect, type Page, test } from "@playwright/test";
import {
	expectNoConsoleErrors,
	REPORT_CLOCK,
	watchConsoleErrors,
} from "../support/reports";
import {
	openTheme,
	themeSearch,
	waitForSettledThemeCards,
} from "../support/themes";

const TAB_TITLES = [
	"Doanh thu & xu hướng",
	"Giờ & ngày trong tuần",
	"Thực đơn",
	"Thanh toán & tiền mặt",
	"Khuyến mãi & giảm giá",
	"Ca & két tiền",
	"So sánh cửa hàng",
	"Chất lượng dữ liệu",
];

function tabs(page: Page) {
	return page.getByTestId("theme-tabs");
}

function path(page: Page): string {
	const hash = new URL(page.url()).hash;
	return hash.includes("?") ? hash.slice(1, hash.indexOf("?")) : hash.slice(1);
}

async function openAddress(page: Page, address: string): Promise<void> {
	watchConsoleErrors(page);
	await page.clock.setFixedTime(REPORT_CLOCK);
	await page.goto(address);
}

test("Chủ đề opens Doanh thu, and so does an address that names no theme, at any depth", async ({
	page,
}) => {
	await openAddress(page, "/#/chu-de");
	await expect(page).toHaveURL(/#\/chu-de\/doanh-thu/);
	await expect(
		page.getByRole("heading", { level: 1, name: "Doanh thu & xu hướng" }),
	).toBeVisible();
	await waitForSettledThemeCards(page);
	await page.goto("/#/chu-de/khong-co?range=91d");
	await expect(page).toHaveURL(/#\/chu-de\/doanh-thu\?range=91d/);
	await page.goto("/#/chu-de/doanh-thu/them/nua?range=7d");
	await expect(page).toHaveURL(/#\/chu-de\/doanh-thu\?range=7d$/);
	await waitForSettledThemeCards(page);
	await page.goto("/#/bao-cao/khong-co/nua");
	await expect(page).toHaveURL(/#\/bao-cao\/ngay(\?|$)/);
	expectNoConsoleErrors(page);
});

test("the tabs list the eight themes in roadmap order and keep the range and the stores", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=91d&store=MOCK-S2");
	await expect(tabs(page).getByRole("link")).toHaveText(TAB_TITLES);
	await tabs(page).getByRole("link", { name: "Giờ & ngày trong tuần" }).click();
	await expect(page).toHaveURL(/#\/chu-de\/gio-ngay\?/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("range")).toBe("91d");
	expect(themeSearch(page).get("store")).toBe("MOCK-S2");
	expectNoConsoleErrors(page);
});

test("the last tab opens Chất lượng dữ liệu with its range picker and the tabs carry the range and the stores on", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=91d&store=MOCK-S2");
	const last = TAB_TITLES[TAB_TITLES.length - 1] ?? "";
	await tabs(page).getByRole("link", { name: last, exact: true }).click();
	await expect(page).toHaveURL(/#\/chu-de\/chat-luong\?/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("range")).toBe("91d");
	expect(themeSearch(page).get("store")).toBe("MOCK-S2");
	await expect(
		page.getByRole("heading", { level: 1, name: last }),
	).toBeVisible();
	await expect(page.getByTestId("range-picker")).toBeVisible();
	await expect(
		tabs(page).getByRole("link", { name: last, exact: true }),
	).toHaveAttribute("aria-current", "page");
	await tabs(page).getByRole("link", { name: "Thực đơn" }).click();
	await expect(page).toHaveURL(/#\/chu-de\/thuc-don\?/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("range")).toBe("91d");
	expect(themeSearch(page).get("store")).toBe("MOCK-S2");
	expect(path(page)).toBe("/chu-de/thuc-don");
	expectNoConsoleErrors(page);
});

test("a range longer than the theme allows and an end after the last complete day are shortened with a notice", async ({
	page,
}) => {
	await openTheme(page, "revenue", "from=2025-01-01&to=2026-11-03");
	await expect(page.getByTestId("range-clamped")).toContainText("400");
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	expect(themeSearch(page).get("from")).toBe("2025-09-30");
	await openTheme(page, "revenue", "from=2026-10-20&to=2026-12-31");
	await expect(page.getByTestId("range-today-clamped")).toBeVisible();
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	expectNoConsoleErrors(page);
});
