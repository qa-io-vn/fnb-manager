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

test("the item table opens on its first 20 rows, shows every row on request and prints them all", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const matrix = themeCard(page, "menu", "menu_matrix");
	const items = matrix.getByRole("table", {
		name: "Xếp loại từng món theo vai trò",
	});
	const allRows = items.locator("tbody tr");
	const shownRows = items.locator("tbody tr:visible");
	const total = await allRows.count();
	expect(total).toBeGreaterThan(20);
	await expect(shownRows).toHaveCount(20);
	const toggle = matrix.getByTestId("table-preview-toggle");
	await expect(toggle).toHaveText(`Xem tất cả ${total} dòng`);
	await toggle.click();
	await expect(toggle).toHaveAttribute("aria-expanded", "true");
	await expect(shownRows).toHaveCount(total);
	await toggle.click();
	await expect(shownRows).toHaveCount(20);
	await page.emulateMedia({ media: "print" });
	await expect(shownRows).toHaveCount(total);
	await expect(toggle).toBeHidden();
	await page.emulateMedia({ media: "screen" });
});

test("every Thực đơn table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const headers: string[] = [];
	for (const id of themeCardIds.menu) {
		headers.push(
			...(await expectCsvTablesWithBom(page, themeCard(page, "menu", id))),
		);
	}
	const text = headers.join(" ");
	for (const label of [
		"Món",
		"Xu hướng",
		"Tỷ trọng kỳ trước",
		"Độ nâng",
		"Lượt chọn",
	]) {
		expect(text).toContain(label);
	}
});

test("no modifier name shows up in a Thực đơn table apart from the sugar and ice card", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const modifier = /\d{1,3}% (Đường|Đá)/;
	for (const id of themeCardIds.menu) {
		const tables = themeCard(page, "menu", id).getByTestId("table-scroll");
		const text = (await tables.allTextContents()).join(" ");
		if (id === "preferences") {
			expect(text).toMatch(modifier);
		} else {
			expect(text, id).not.toMatch(modifier);
		}
	}
});

test("the uncategorised demo item shows in the category mix with the categories link", async ({
	page,
}) => {
	await openTheme(page, "menu");
	const categories = themeCard(page, "menu", "category_mix");
	await expect(
		categories.getByRole("table", {
			name: "Doanh thu theo nhóm món",
			exact: true,
		}),
	).toContainText("Chưa phân loại");
	await expect(
		categories.getByRole("link", { name: "Phân loại món" }),
	).toHaveAttribute("href", /cai-dat\/phan-loai\?tab=nhom-mon/);
	const attach = themeCard(page, "menu", "attach");
	await expect(attach.getByTestId("headline")).not.toHaveText("—");
	await expect(attach.getByTestId("comparison-chip")).toHaveCount(2);
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
