import { expect, test } from "@playwright/test";
import {
	checkPage,
	expectLastColumnReachable,
	PHONE_WIDTH,
	waitForCharts,
} from "../support/checks";
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
} from "../support/themes";

test("Giờ & ngày settles every card over the default range", async ({
	page,
}) => {
	await openTheme(page, "hours");
	await expect(
		page.getByRole("heading", { level: 1, name: "Giờ & ngày trong tuần" }),
	).toBeVisible();
	await expect(themeCards(page, "hours")).toHaveCount(
		themeCardIds.hours.length,
	);
	await expectEveryThemeCardSettled(page, "hours");
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "hours");
});

test("the heat table runs Monday to Sunday and its last column is reachable on a phone", async ({
	page,
}) => {
	await page.setViewportSize({ width: PHONE_WIDTH, height: 900 });
	await openTheme(page, "hours");
	const heat = themeCard(page, "hours", "heatmap");
	const table = heat.getByTestId("table-scroll").first();
	await expect(table.locator("thead th")).toHaveText([
		/Giờ/,
		/T2/,
		/T3/,
		/T4/,
		/T5/,
		/T6/,
		/T7/,
		/CN/,
		/Trung bình/,
	]);
	await expectLastColumnReachable(page, table);
});

test("peak hours, the busiest weekday and shift windows read from the profile", async ({
	page,
}) => {
	await openTheme(page, "hours", "range=28d&store=MOCK-S1");
	const peaks = themeCard(page, "hours", "peak_dead");
	await expect(peaks.getByTestId("headline")).toHaveText(/\d.*%/);
	await expect(peaks.getByTestId("sentence")).toContainText("Giờ cao điểm");
	await expect(peaks.getByTestId("comparison-chip")).toContainText(
		"so với 4 tuần trước",
	);
	await expect(
		themeCard(page, "hours", "weekday").getByTestId("sentence"),
	).toContainText("bán tốt nhất");
	await expect(
		themeCard(page, "hours", "shift_windows").getByTestId("sentence"),
	).toContainText("năng suất nhân viên");
	const productivity = themeCard(page, "hours", "productivity");
	await expect(productivity.getByTestId("headline")).toHaveText(/\d/);
	await expect(productivity.getByTestId("card-notice")).toHaveCount(0);
});

test("the young store without opening hours is sent to the store settings", async ({
	page,
}) => {
	await openTheme(page, "hours", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "hours");
	const productivity = themeCard(page, "hours", "productivity");
	await expect(productivity.getByTestId("headline")).toHaveText("—");
	await expect(
		productivity
			.getByTestId("card-notice")
			.getByRole("link", { name: "Nhập giờ mở cửa và số ghế" }),
	).toHaveAttribute("href", "#/cai-dat/cua-hang");
});

test("a week is too short for shift windows", async ({ page }) => {
	await openTheme(page, "hours", "range=7d");
	await expect(
		themeCard(page, "hours", "shift_windows").getByTestId("card-notice"),
	).toContainText("ít nhất 14 ngày");
});

test("every Giờ & ngày table downloads as UTF-8 CSV with a BOM", async ({
	page,
}) => {
	await openTheme(page, "hours");
	const headers: string[] = [];
	for (const id of themeCardIds.hours) {
		headers.push(
			...(await expectCsvTablesWithBom(page, themeCard(page, "hours", id))),
		);
	}
	expect(headers.join(" ")).toContain("Doanh thu trung bình mỗi ngày");
});

test("Giờ & ngày prints without controls, passes axe, fits 360 px and reads in English", async ({
	page,
}) => {
	await openTheme(page, "hours");
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Hours and weekdays");
});
