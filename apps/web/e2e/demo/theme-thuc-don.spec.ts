import { expect, test } from "@playwright/test";
import { checkPage, waitForCharts } from "../support/checks";
import { expectNoExternalRequests } from "../support/reports";
import {
	choosePreset,
	expectCsvTablesWithBom,
	expectEveryThemeCardSettled,
	expectThemeInEnglish,
	expectThemePrintLayout,
	openTheme,
	themeCard,
	themeCardIds,
	themeCards,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test("Thực đơn settles the matrix and the margins over the default range", async ({
	page,
}) => {
	await openTheme(page, "menu");
	await expect(
		page.getByRole("heading", { level: 1, name: "Thực đơn" }),
	).toBeVisible();
	await expect(themeCards(page, "menu")).toHaveCount(themeCardIds.menu.length);
	await expectEveryThemeCardSettled(page, "menu");
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "menu");
});

test("the matrix classes the drinks provisionally and the margins ask for costs", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const matrix = themeCard(page, "menu", "menu_matrix");
	await expect(matrix).toContainText("ngôi sao");
	await expect(matrix).toContainText("tạm tính");
	const margins = themeCard(page, "menu", "margins");
	await expect(margins).toContainText("Nhập giá vốn");
	await expect(
		margins.getByRole("link", { name: /Cài đặt|giá vốn/i }).first(),
	).toBeVisible();
});

test("every Thực đơn table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const headers = await expectCsvTablesWithBom(
		page,
		themeCard(page, "menu", "menu_matrix"),
	);
	expect(headers.join(" ")).toContain("Món");
});

test("Thực đơn prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("menu"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Menu");
});
