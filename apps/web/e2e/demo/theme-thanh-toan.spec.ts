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
	expectCsvTablesWithBom,
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
	await expect(page.getByTestId("catch-up-banner")).toHaveCount(0);
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
	expectNoConsoleErrors(page);
});

test("a custom range survives a reload, steps by its own length and comes back", async ({
	page,
}) => {
	await expectRangeRoundTrip(page, "payments");
	expectNoConsoleErrors(page);
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
	expectNoConsoleErrors(page);
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
	for (const label of [
		"Loại",
		"Phương thức",
		"Tỷ trọng tiền mặt",
		"Tiền mặt dự kiến",
		"Phí POS ghi nhận",
	]) {
		expect(text).toContain(label);
	}
	expectNoConsoleErrors(page);
});

test("the drawer card states the thresholds and labels shifts Ca n on screen, in CSV and in print", async ({
	page,
}) => {
	await openTheme(page, "payments");
	const drawer = themeCard(page, "payments", "drawer");
	await expect(drawer.getByTestId("sentence")).toContainText("Ngưỡng:");
	await expect(drawer.getByTestId("sentence")).toContainText("50.000");
	await expectShiftsLabelledByNumber(
		page,
		"card-payments-drawer",
		/Ca (sáng|chiều|tối)/,
	);
	expectNoConsoleErrors(page);
});

test("the fee card shows a dash and the fees link while no fee rate is entered", async ({
	page,
}) => {
	await openTheme(page, "payments");
	const fees = themeCard(page, "payments", "fees");
	await expect(fees.getByTestId("headline")).toHaveText("—");
	await expect(fees.getByTestId("card-notice")).toBeVisible();
	await expect(
		fees.getByTestId("card-notice").getByRole("link"),
	).toHaveAttribute("href", /cai-dat\/du-lieu-nhap-tay\?tab=phi/);
	expectNoConsoleErrors(page);
});

test("Thanh toán prints without controls, passes axe, fits 360 px, stays local and reads in English", async ({
	page,
}) => {
	watchConsoleErrors(page);
	await expectNoExternalRequests(page, async () => {
		await page.goto(themeUrl("payments"));
		await waitForSettledThemeCards(page);
	});
	await waitForCharts(page);
	await expectThemePrintLayout(page);
	await checkPage(page);
	await expectThemeInEnglish(page, "Payments and cash");
	expectNoConsoleErrors(page);
});

test("Thanh toán downloads every table semicolon-separated with its exact headers and decimal commas on a device set to that format", async ({
	page,
}) => {
	await chooseSemicolonCsv(page);
	await openTheme(page, "payments");
	const texts: string[] = [];
	for (const id of themeCardIds.payments) {
		texts.push(
			...(await expectSemicolonCsvTables(
				page,
				themeCard(page, "payments", id),
			)),
		);
	}
	expectDecimalCommas(texts);
	expectNoConsoleErrors(page);
});
