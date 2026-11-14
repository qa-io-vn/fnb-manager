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
	themeSearch,
	themeUrl,
	waitForSettledThemeCards,
} from "../support/themes";

test("Thanh toán opens on the last four weeks with both cards settled", async ({
	page,
}) => {
	await openTheme(page, "payments");
	await expect(
		page.getByRole("heading", { level: 1, name: "Thanh toán & tiền mặt" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "payments")).toHaveCount(
		themeCardIds.payments.length,
	);
	await expectEveryThemeCardSettled(page, "payments");
	const mix = themeCard(page, "payments", "payment_mix");
	await expect(mix.getByTestId("comparison-chip")).toHaveCount(2);
	await expect(mix.getByTestId("comparison-chip").first()).toContainText(
		"so với 4 tuần trước",
	);
	const buckets = themeCard(page, "payments", "cash_trend").getByRole("table", {
		name: "Doanh thu và tiền mặt theo thời gian",
		exact: true,
	});
	await expect(buckets.getByRole("columnheader").first()).toContainText("Ngày");
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "payments");
	await expect(buckets.getByRole("columnheader").first()).toContainText(
		"Tuần từ",
	);
});

test("a custom range survives a reload and steps by its own length", async ({
	page,
}) => {
	await openTheme(page, "payments", "from=2026-10-08&to=2026-10-21");
	await expect(page.getByTestId("range-label")).toContainText("14 ngày");
	await page.reload();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("to")).toBe("2026-10-21");
	await page.getByRole("button", { name: "Khoảng trước" }).click();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-09-24");
	expect(themeSearch(page).get("to")).toBe("2026-10-07");
});

test("the young store has no last year to compare the cash share with", async ({
	page,
}) => {
	await openTheme(page, "payments", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "payments");
	await expect(
		themeCard(page, "payments", "payment_mix")
			.getByTestId("comparison-chip")
			.nth(1),
	).toContainText("chưa có dữ liệu năm trước");
});

test("every Thanh toán table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "payments");
	const headers: string[] = [];
	for (const id of themeCardIds.payments) {
		headers.push(
			...(await expectCsvTablesWithBom(page, themeCard(page, "payments", id))),
		);
	}
	const text = headers.join(" ");
	for (const label of ["Loại", "Phương thức", "Tỷ trọng tiền mặt"]) {
		expect(text).toContain(label);
	}
});

test("Thanh toán prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("payments"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Payments and cash");
});
