import { expect, test } from "@playwright/test";
import { checkPage, waitForCharts } from "../support/checks";
import {
	expectNoConsoleErrors,
	expectNoExternalRequests,
	expectShiftsLabelledByNumber,
	watchConsoleErrors,
} from "../support/reports";
import {
	choosePreset,
	chooseSemicolonCsv,
	csvTablesWithBom,
	expectDecimalCommas,
	expectEveryThemeCardSettled,
	expectRangeRoundTrip,
	expectSemicolonCsvTables,
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

const POS_SHIFT_NAMES = /Ca (sáng|chiều|tối)/;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const SORT_ARROWS = /[↑↓↕]\s*$/;

test("Ca & két tiền opens on the last four weeks with its three cards settled, and 13 weeks fit", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	await expect(
		page.getByRole("heading", { level: 1, name: "Ca & két tiền" }),
	).toBeVisible();
	expect(themeSearch(page).get("range")).toBe("28d");
	await expect(themeCards(page, "shifts")).toHaveCount(
		themeCardIds.shifts.length,
	);
	await expectEveryThemeCardSettled(page, "shifts");
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
	await expect(page.getByTestId("range-clamped")).toHaveCount(0);
	await expect(
		themeCard(page, "shifts", "shift_sales").getByTestId("sentence"),
	).toContainText(/Ca \d cao nhất/);
	await choosePreset(page, "13 tuần");
	await expectEveryThemeCardSettled(page, "shifts");
	expect(themeSearch(page).get("range")).toBe("91d");
	await expect(page.getByTestId("range-clamped")).toHaveCount(0);
	expectNoConsoleErrors(page);
});

test("a preset or a link longer than 92 days is shortened to the last 92 days with the notice, and steps by 92 days", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	await page
		.getByTestId("range-presets")
		.getByRole("radio", { name: "52 tuần" })
		.click();
	await expect(page.getByTestId("range-clamped")).toContainText("92");
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	await expect(page.getByTestId("range-label")).toContainText("92 ngày");
	await expectEveryThemeCardSettled(page, "shifts");
	await page.getByRole("button", { name: "Khoảng trước" }).click();
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-05-04");
	expect(themeSearch(page).get("to")).toBe("2026-08-03");
	await openTheme(page, "shifts", "from=2026-01-01&to=2026-11-03");
	await expect(page.getByTestId("range-clamped")).toContainText("92");
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expectNoConsoleErrors(page);
});

test("the tab from a year-long range of another theme opens the last 92 days", async ({
	page,
}) => {
	await openTheme(page, "revenue", "range=364d&store=MOCK-S1");
	await page
		.getByTestId("theme-tabs")
		.getByRole("link", { name: "Ca & két tiền" })
		.click();
	await expect(page).toHaveURL(/#\/chu-de\/ca-ket-tien\?/);
	await waitForSettledThemeCards(page);
	expect(themeSearch(page).get("from")).toBe("2026-08-04");
	expect(themeSearch(page).get("to")).toBe("2026-11-03");
	expect(themeSearch(page).get("store")).toBe("MOCK-S1");
	await expectEveryThemeCardSettled(page, "shifts");
	expectNoConsoleErrors(page);
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "shifts");
	expectNoConsoleErrors(page);
});

test("the young store settles every card, and its first weeks show the z-score dash with the notice", async ({
	page,
}) => {
	await openTheme(page, "shifts", "range=28d&store=MOCK-S2");
	await expectEveryThemeCardSettled(page, "shifts");
	await openTheme(
		page,
		"shifts",
		"from=2026-08-31&to=2026-09-13&store=MOCK-S2",
	);
	await expectEveryThemeCardSettled(page, "shifts");
	const adjustments = themeCard(page, "shifts", "adjustments");
	await expect(adjustments.getByTestId("card-notice")).toContainText(
		"chưa có đủ 3 ca trước đó",
	);
	const table = adjustments.getByRole("table", {
		name: "Các ca, điểm z cao nhất trước",
		exact: true,
	});
	const headers = (await table.locator("thead th").allTextContents()).map(
		(text) => text.replace(SORT_ARROWS, "").trim(),
	);
	for (const label of ["Điểm z hủy", "Điểm z xóa món"]) {
		const column = headers.indexOf(label);
		expect(column, label).toBeGreaterThan(0);
		const cells = await table
			.locator(`tbody tr td:nth-child(${column + 1})`)
			.allTextContents();
		expect(cells.length, label).toBeGreaterThan(10);
		expect(
			cells.map((cell) => cell.trim()),
			label,
		).toContain("—");
	}
	expectNoConsoleErrors(page);
});

test("the drawer and adjustment cards state their thresholds and basis, and the drawer has a table per cashier", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	const drawer = themeCard(page, "shifts", "drawer");
	await expect(drawer.getByTestId("sentence")).toContainText("Ngưỡng:");
	await expect(drawer.getByTestId("sentence")).toContainText("50.000");
	await expect(
		drawer.getByRole("table", { name: "Lệch két theo thu ngân" }),
	).toBeVisible();
	const adjustments = themeCard(page, "shifts", "adjustments");
	await expect(adjustments.getByTestId("sentence")).toContainText(
		"không phải kết luận về một người",
	);
	await expect(adjustments.getByTestId("sentence")).toContainText(
		"56 ngày trước",
	);
	expectNoConsoleErrors(page);
});

test("every card labels shifts Ca n on screen, in CSV and in print, never with a POS name or an e-mail address", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	for (const id of themeCardIds.shifts) {
		await expectShiftsLabelledByNumber(
			page,
			`card-shifts-${id}`,
			POS_SHIFT_NAMES,
		);
		await expect(themeCard(page, "shifts", id)).not.toContainText("@");
	}
	expectNoConsoleErrors(page);
});

test("every Ca & két tiền table downloads as UTF-8 CSV with a BOM, its headers and no @", async ({
	page,
}) => {
	await openTheme(page, "shifts");
	const texts: string[] = [];
	for (const id of themeCardIds.shifts) {
		texts.push(
			...(await csvTablesWithBom(page, themeCard(page, "shifts", id))),
		);
	}
	expect(texts).toHaveLength(4);
	const all = texts.join("\r\n");
	for (const label of [
		"Mở ca",
		"Đóng ca",
		"Tiền mặt dự kiến",
		"Tổng lệch két",
		"Điểm z hủy",
		"Sửa sau khi đóng ca",
	]) {
		expect(all).toContain(label);
	}
	expect(all).toContain("Ca 1");
	expect(all).not.toContain("@");
	expect(all).not.toMatch(EMAIL_PATTERN);
	expect(all).not.toMatch(POS_SHIFT_NAMES);
	expectNoConsoleErrors(page);
});

test("Ca & két tiền prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("shifts"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Shifts and cash drawer");
	expectNoConsoleErrors(page);
});

test("Ca & két tiền downloads every table semicolon-separated with its exact headers and decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "shifts");
	const texts: string[] = [];
	for (const id of themeCardIds.shifts) {
		texts.push(
			...(await expectSemicolonCsvTables(page, themeCard(page, "shifts", id))),
		);
	}
	expectDecimalCommas(texts);
	expect(texts.join("\r\n")).not.toContain("@");
	expectNoConsoleErrors(page);
});
